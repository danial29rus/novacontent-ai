from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, RateLimited
from app.models import AIModel, LedgerEntry, Payment, TopupPackage
from app.schemas import AIModelOut, LedgerOut, PackageOut, PaymentOut, TopupIn
from app.services import billing, estimates, growth

router = APIRouter(tags=["billing"])


@router.get("/models", response_model=list[AIModelOut])
async def list_models(db: DB) -> list[AIModel]:
    return list((await db.scalars(
        select(AIModel).where(AIModel.is_active).order_by(AIModel.sort)
    )).all())


@router.get("/billing/packages", response_model=list[PackageOut])
async def packages(db: DB) -> list[TopupPackage]:
    return list((await db.scalars(
        select(TopupPackage).where(TopupPackage.is_active).order_by(TopupPackage.price_kopeks)
    )).all())


@router.get("/billing/estimates")
async def billing_estimates(db: DB) -> dict:
    """Public: how many sparks typical tasks take, priced from current model and service prices."""
    models = list((await db.scalars(select(AIModel).where(AIModel.is_active).order_by(AIModel.sort))).all())
    packages = list((await db.scalars(select(TopupPackage).where(TopupPackage.is_active))).all())
    default = next((m for m in models if m.is_default), models[0])
    return estimates.build({m.slug: m for m in models}, default, packages)


@router.get("/billing/custom-quote")
async def custom_quote(amount_rub: int) -> dict:
    """Sparks for an arbitrary amount, so the UI and the charge always agree."""
    amount = max(0, amount_rub)
    return {"amount_rub": amount, "bonus_percent": billing.custom_bonus(amount),
            "sparks": billing.custom_sparks(amount), "min_rub": 500,
            "ladder": [{"from_rub": t, "bonus_percent": b} for t, b in reversed(billing.BONUS_LADDER)]}


@router.get("/billing/ledger", response_model=list[LedgerOut])
async def ledger(user: CurrentUser, db: DB, limit: int = 50) -> list[LedgerEntry]:
    return list((await db.scalars(
        select(LedgerEntry).where(LedgerEntry.user_id == user.id)
        .order_by(LedgerEntry.id.desc()).limit(min(limit, 200))
    )).all())


@router.get("/billing/usage")
async def usage(user: CurrentUser, db: DB, days: int = 14) -> list[dict]:
    """Daily spend for the cabinet chart."""
    since = datetime.now(UTC) - timedelta(days=min(days, 90))
    day = func.date_trunc("day", LedgerEntry.created_at)
    rows = (await db.execute(
        select(day.label("day"), func.sum(-LedgerEntry.amount).label("spent"))
        .where(LedgerEntry.user_id == user.id, LedgerEntry.kind == "usage", LedgerEntry.created_at >= since)
        .group_by(day).order_by(day)
    )).all()
    return [{"day": r.day.date().isoformat(), "spent": int(r.spent)} for r in rows]


@router.post("/billing/topup", dependencies=[RateLimited])
async def topup(body: TopupIn, user: CurrentUser, db: DB) -> dict:
    if not billing.payments_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Оплата временно недоступна. Напишите нам в разделе «Поддержка».")
    package = None
    if body.package_slug:
        package = await db.scalar(
            select(TopupPackage).where(TopupPackage.slug == body.package_slug, TopupPackage.is_active)
        )
        if package is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Пакет не найден.")
    elif body.amount_rub is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выберите пакет или укажите сумму от 500 ₽.")
    promo = None
    if body.promo_code:
        rub_amount = package.price_kopeks // 100 if package else body.amount_rub
        try:
            promo = await growth.find_promo(db, body.promo_code, user, kind="topup", amount_rub=rub_amount)
        except growth.PromoError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from None
    payment, url = await billing.create_payment(db, user, package, body.amount_rub, promo)
    await db.refresh(user)
    return {"payment": PaymentOut.model_validate(payment), "confirmation_url": url, "balance": user.balance}


@router.get("/billing/payments", response_model=list[PaymentOut])
async def payments(user: CurrentUser, db: DB) -> list[Payment]:
    return list((await db.scalars(
        select(Payment).where(Payment.user_id == user.id).order_by(Payment.id.desc()).limit(50)
    )).all())
