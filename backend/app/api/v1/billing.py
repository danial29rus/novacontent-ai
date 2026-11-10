import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, RateLimited
from app.core.config import settings
from app.models import AIModel, LedgerEntry, Payment, TopupPackage
from app.schemas import AIModelOut, LedgerOut, PackageOut, PaymentOut, TopupIn
from app.services import billing, estimates, growth, payhot

router = APIRouter(tags=["billing"])
log = logging.getLogger(__name__)


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
            "sparks": billing.custom_sparks(amount), "min_rub": billing.MIN_TOPUP_RUB,
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Выберите пакет или укажите сумму от {billing.MIN_TOPUP_RUB} ₽.")
    promo = None
    if body.promo_code:
        rub_amount = package.price_kopeks // 100 if package else body.amount_rub
        try:
            promo = await growth.find_promo(db, body.promo_code, user, kind="topup", amount_rub=rub_amount)
        except growth.PromoError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from None
    method = body.payment_method or settings.payhot_methods[0]
    if settings.payment_provider == "payhot" and method not in settings.payhot_methods:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Этот способ оплаты недоступен.")
    try:
        payment, url = await billing.create_payment(db, user, package, body.amount_rub, promo, method)
    except payhot.PayHotError as error:
        log.error("PayHot create failed for user %s: %s", user.id, error)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Не удалось создать платёж. Попробуйте позже или выберите другой способ оплаты.") from None
    await db.refresh(user)
    return {"payment": PaymentOut.model_validate(payment), "confirmation_url": url, "balance": user.balance}


@router.get("/billing/payments", response_model=list[PaymentOut])
async def payments(user: CurrentUser, db: DB) -> list[Payment]:
    return list((await db.scalars(
        select(Payment).where(Payment.user_id == user.id).order_by(Payment.id.desc()).limit(50)
    )).all())


@router.get("/billing/methods")
async def payment_methods() -> dict:
    methods = settings.payhot_methods if settings.payment_provider == "payhot" else []
    return {"methods": methods, "default": methods[0] if methods else None}


@router.get("/billing/payments/{payment_id}/sbp")
async def payment_sbp(payment_id: int, user: CurrentUser, db: DB, link: bool = True) -> dict:
    """Polled by the QR dialog: the bank link plus whether the payment has gone through."""
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Платёж не найден.")
    await billing.refresh_payment(db, payment)
    await db.refresh(user)
    result = {"status": payment.status, "sbp": None, "balance": user.balance}
    if payment.status != "pending" or not link or payment.provider != "payhot" or not payment.provider_payment_id:
        return result
    try:
        sbp = await payhot.client().get_sbp_link(payment.provider_payment_id)
        # Undocumented statuses (e.g. hosted_checkout_required) mean no direct link: use the checkout QR.
        known = sbp.status in ("pending", "available", "expired")
        result["sbp"] = {"status": sbp.status if known else "unavailable", "url": sbp.url if known else None,
                         "expires_at": sbp.expires_at}
    except payhot.PayHotError as error:
        # 409: PayHot has no direct link for this payment, the dialog switches to the checkout page.
        # Anything else (DDoS-Guard 403, timeout) is temporary and the dialog asks again.
        final = error.status == 409
        result["sbp"] = {"status": "unavailable" if final else "retry", "url": None, "expires_at": None}
        log.warning("PayHot direct SBP unavailable for payment %s: %s", payment.id, error)
    return result


@router.post("/billing/payments/sync")
async def sync_payments(user: CurrentUser, db: DB) -> dict:
    """Called when the user comes back from checkout: re-checks pending payments with PayHot."""
    credited = await billing.sync_pending(db, user.id)
    await db.refresh(user)
    return {"credited": credited, "balance": user.balance}


@router.post("/billing/webhooks/payhot", include_in_schema=False)
async def payhot_webhook(request: Request, db: DB) -> Response:
    body = await request.body()
    if not payhot.verify_signature(request.headers.get("PayHot-Signature"), body):
        return Response(status_code=401)
    try:
        event = json.loads(body)
    except ValueError:
        return Response(status_code=400)

    data = event.get("data") or {}
    if data.get("object", "payment") != "payment":
        return Response(status_code=204)
    provider_id = str(data.get("id") or "")
    payment = await db.scalar(select(Payment).where(Payment.provider == "payhot",
                                                    Payment.provider_payment_id == provider_id))
    if payment is None:
        log.warning("PayHot webhook for unknown payment %r (event %s)", provider_id, event.get("event_id"))
        return Response(status_code=204)

    # Don't trust the body's status alone: ask PayHot, which also makes duplicates and reordering harmless.
    await billing.refresh_payment(db, payment)
    if payment.status == "pending" and payment.error:
        return Response(status_code=503)  # couldn't reach PayHot, it will retry the webhook
    return Response(status_code=204)
