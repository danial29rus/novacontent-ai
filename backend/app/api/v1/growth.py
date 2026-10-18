from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, RateLimited
from app.core.config import settings
from app.models import Payment, ReferralReward, User
from app.schemas import RedeemIn
from app.services import growth

router = APIRouter(tags=["growth"])


@router.get("/referral")
async def referral(user: CurrentUser, db: DB) -> dict:
    code = await growth.ensure_ref_code(db, user)
    invited = list(await db.scalars(select(User).where(User.referred_by_id == user.id).order_by(User.id.desc())))
    earned = dict((await db.execute(
        select(ReferralReward.referred_id, func.sum(ReferralReward.sparks))
        .where(ReferralReward.referrer_id == user.id).group_by(ReferralReward.referred_id)
    )).all())
    paying = set(await db.scalars(select(Payment.user_id).where(
        Payment.user_id.in_([u.id for u in invited] or [0]), Payment.status == "succeeded")))
    return {
        "code": code,
        "link": f"{settings.public_url}/?ref={code}",
        "signup_bonus": settings.referral_signup_bonus,
        "percent": settings.referral_percent,
        "invited": len(invited),
        "paying": len(paying),
        "earned": int(sum(earned.values())),
        # Friends are shown with a masked name only.
        "friends": [{"name": u.name[:1] + "•••", "joined_at": u.created_at, "paid": u.id in paying,
                     "earned": int(earned.get(u.id, 0))} for u in invited[:50]],
    }


@router.post("/promo/redeem", dependencies=[RateLimited])
async def redeem(body: RedeemIn, user: CurrentUser, db: DB) -> dict:
    try:
        promo, balance = await growth.redeem_gift(db, user, body.code)
    except growth.PromoError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from None
    return {"code": promo.code, "sparks": promo.value, "balance": balance}


@router.get("/promo/check", dependencies=[RateLimited])
async def check(code: str, user: CurrentUser, db: DB, amount_rub: int | None = None) -> dict:
    """Preview a code before paying: what it gives and whether it applies to this amount."""
    try:
        promo = await growth.find_promo(db, code, user, amount_rub=amount_rub)
    except growth.PromoError as error:
        return {"valid": False, "message": str(error)}
    if promo.kind == "gift":
        return {"valid": True, "kind": "gift", "value": promo.value, "code": promo.code,
                "message": f"Подарок {promo.value} ✦ — активируйте кнопкой «Активировать»"}
    return {"valid": True, "kind": "topup", "value": promo.value, "code": promo.code,
            "min_topup_rub": promo.min_topup_rub, "message": f"+{promo.value}% искр к пополнению"
            + (f" от {promo.min_topup_rub} ₽" if promo.min_topup_rub else "")}
