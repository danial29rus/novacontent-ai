"""Admin: promo codes and traffic attribution (sources, campaigns, referrers)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import aliased

from app.api.deps import DB, AdminUser
from app.models import AuditEvent, Payment, PromoCode, PromoRedemption, ReferralReward, User
from app.schemas import PromoIn, PromoOut, PromoUpdate
from app.services.growth import normalize

router = APIRouter(prefix="/admin", tags=["admin"])

paid = Payment.status == "succeeded"


@router.get("/promo")
async def list_promo(_: AdminUser, db: DB) -> list[dict]:
    promos = list(await db.scalars(select(PromoCode).order_by(PromoCode.id.desc())))
    signups = dict((await db.execute(
        select(User.signup_promo, func.count()).where(User.signup_promo != "").group_by(User.signup_promo)
    )).all())
    revenue = {pid: (n, int(r or 0), int(b or 0)) for pid, n, r, b in (await db.execute(
        select(Payment.promo_id, func.count(), func.sum(Payment.amount_kopeks), func.sum(Payment.bonus_sparks))
        .where(paid, Payment.promo_id.is_not(None)).group_by(Payment.promo_id)
    )).all()}
    gifted = dict((await db.execute(
        select(PromoRedemption.promo_id, func.sum(PromoRedemption.sparks)).group_by(PromoRedemption.promo_id)
    )).all())
    out = []
    for p in promos:
        payments, rev, bonus = revenue.get(p.id, (0, 0, 0))
        out.append({**PromoOut.model_validate(p).model_dump(mode="json"), "signups": signups.get(p.code, 0),
                    "payments": payments, "revenue_rub": rev / 100,
                    "sparks_given": int(gifted.get(p.id, 0) or 0) if p.kind == "gift" else bonus})
    return out


@router.post("/promo", response_model=PromoOut, status_code=201)
async def create_promo(body: PromoIn, actor: AdminUser, db: DB) -> PromoCode:
    code = normalize(body.code)
    if await db.scalar(select(PromoCode.id).where(PromoCode.code == code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой промокод уже есть.")
    if body.kind == "topup" and body.value > 300:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Бонус к оплате — не больше 300%.")
    promo = PromoCode(**{**body.model_dump(), "code": code})
    db.add(promo)
    db.add(AuditEvent(actor_id=actor.id, action="promo_create", details={"code": code, "kind": body.kind,
                                                                        "value": body.value}))
    await db.commit()
    return promo


@router.patch("/promo/{promo_id}", response_model=PromoOut)
async def update_promo(promo_id: int, body: PromoUpdate, actor: AdminUser, db: DB) -> PromoCode:
    promo = await db.get(PromoCode, promo_id)
    if promo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Промокод не найден.")
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(promo, key, value)
    db.add(AuditEvent(actor_id=actor.id, action="promo_update",
                      details={"code": promo.code, **{k: str(v) for k, v in changes.items()}}))
    await db.commit()
    await db.refresh(promo)
    return promo


@router.get("/traffic")
async def traffic(_: AdminUser, db: DB, days: int = 30) -> dict:
    """Sign-ups and money per acquisition channel for users who joined in the period."""
    since = datetime.now(UTC) - timedelta(days=min(days, 365))
    cohort = User.created_at >= since

    def channel_rows(column):
        return (
            select(column, func.count(distinct(User.id)), func.count(distinct(Payment.user_id)),
                   func.coalesce(func.sum(Payment.amount_kopeks), 0), func.count(Payment.id))
            .select_from(User).outerjoin(Payment, (Payment.user_id == User.id) & paid)
            .where(cohort).group_by(column).order_by(func.count(distinct(User.id)).desc())
        )

    def shape(rows) -> list[dict]:
        return [{"key": key or "—", "signups": s, "paying": p, "revenue_rub": r / 100, "payments": n,
                 "conversion": round(p / s * 100, 1) if s else 0, "arpu_rub": round(r / 100 / s, 2) if s else 0}
                for key, s, p, r, n in rows]

    daily_day = func.date_trunc("day", User.created_at)
    daily = (await db.execute(select(daily_day, func.count()).where(cohort).group_by(daily_day)
                              .order_by(daily_day))).all()

    referrer = aliased(User)
    referred = aliased(User)
    rewards = (select(ReferralReward.referrer_id, func.sum(ReferralReward.sparks).label("earned"))
               .group_by(ReferralReward.referrer_id).subquery())
    top_referrers = (await db.execute(
        select(referrer.email, referrer.ref_code, func.count(distinct(referred.id)),
               func.count(distinct(Payment.user_id)), func.coalesce(func.sum(Payment.amount_kopeks), 0),
               func.coalesce(func.max(rewards.c.earned), 0))
        .join(referred, referred.referred_by_id == referrer.id)
        .outerjoin(Payment, (Payment.user_id == referred.id) & paid)
        .outerjoin(rewards, rewards.c.referrer_id == referrer.id)
        .group_by(referrer.email, referrer.ref_code)
        .order_by(func.count(distinct(referred.id)).desc()).limit(20)
    )).all()

    return {
        "signups": await db.scalar(select(func.count()).select_from(User).where(cohort)),
        "referred_signups": await db.scalar(select(func.count()).select_from(User)
                                            .where(cohort, User.referred_by_id.is_not(None))),
        "referral_paid_sparks": int(await db.scalar(select(func.coalesce(func.sum(ReferralReward.sparks), 0))
                                                    .where(ReferralReward.created_at >= since)) or 0),
        "by_source": shape((await db.execute(channel_rows(User.signup_source))).all()),
        "by_campaign": shape((await db.execute(channel_rows(User.signup_campaign))).all()),
        "by_promo": shape((await db.execute(channel_rows(User.signup_promo))).all()),
        "daily": [{"day": d.date().isoformat(), "signups": n} for d, n in daily],
        "referrers": [{"email": e, "code": c, "invited": i, "paying": p, "revenue_rub": r / 100, "earned": int(x)}
                      for e, c, i, p, r, x in top_referrers],
    }
