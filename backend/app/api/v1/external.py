"""Payments API for external services (bot, partner backend), protected by a bearer token.

POST /api/v1/external/payments                    create a payment link for a user
GET  /api/v1/external/payments/{transaction_id}   payment status (kept fresh by the worker)

The caller's transaction_id (uuid) becomes our order_id and PayHot's merchant_order_reference.
When paid, the user gets sparks by the same rules as a top-up on the site.
"""
import hmac
import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB
from app.core.config import settings
from app.models import Payment, User
from app.services import billing, payhot

router = APIRouter(prefix="/external", tags=["external"])
log = logging.getLogger(__name__)


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token or not any(hmac.compare_digest(token, t) for t in settings.payments_api_tokens):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный или отсутствующий токен",
                            headers={"WWW-Authenticate": "Bearer"})


Authorized = [Depends(require_token)]


class CreatePaymentIn(BaseModel):
    transaction_id: uuid.UUID
    user_id: int = Field(gt=0)
    amount_rub: int = Field(ge=billing.MIN_TOPUP_RUB, le=billing.MAX_TOPUP_RUB)


class PaymentStatusOut(BaseModel):
    transaction_id: str
    user_id: int
    amount_rub: int
    sparks: int
    status: str  # pending | succeeded | failed | canceled
    paid: bool
    payment_url: str | None  # PayHot checkout page ("go to payment" button)
    qr_url: str | None = None  # link to render as a QR code (the PayHot payment page, opens SBP)
    created_at: datetime
    paid_at: datetime | None


def _out(payment: Payment) -> PaymentStatusOut:
    link = payment.checkout_url if payment.status == "pending" else None
    return PaymentStatusOut(
        transaction_id=payment.order_id, user_id=payment.user_id, amount_rub=payment.amount_kopeks // 100,
        sparks=payment.tokens, status=payment.status, paid=payment.status == "succeeded",
        payment_url=link, qr_url=link, created_at=payment.created_at, paid_at=payment.paid_at,
    )


@router.post("/payments", response_model=PaymentStatusOut, dependencies=Authorized)
async def create_payment(body: CreatePaymentIn, db: DB) -> PaymentStatusOut:
    """Creates a payment link. Repeating the same transaction_id returns the existing payment."""
    transaction_id = str(body.transaction_id)
    existing = await db.scalar(select(Payment).where(Payment.order_id == transaction_id))
    if existing is not None and existing.status == "failed" and not existing.provider_payment_id:
        # PayHot never created it (network / DDoS-Guard): let the caller retry with the same id.
        await db.delete(existing)
        await db.commit()
        existing = None
    if existing is not None:
        if existing.user_id != body.user_id or existing.amount_kopeks != body.amount_rub * 100:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "transaction_id уже использован с другим пользователем или суммой")
        return _out(existing)

    if not billing.payments_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Приём оплаты отключён")
    user = await db.get(User, body.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден или заблокирован")

    try:
        payment, _ = await billing.create_payment(db, user, None, body.amount_rub, order_id=transaction_id)
    except payhot.PayHotError as error:
        log.error("external create failed for %s: %s", transaction_id, error)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Платёжная система не создала платёж, повторите позже") \
            from None
    return _out(payment)


@router.get("/payments/{transaction_id}", response_model=PaymentStatusOut, dependencies=Authorized)
async def payment_status(transaction_id: uuid.UUID, db: DB) -> PaymentStatusOut:
    """Status from our database; the worker syncs it with PayHot every 30 s."""
    payment = await db.scalar(select(Payment).where(Payment.order_id == str(transaction_id)))
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Платёж не найден")
    return _out(payment)
