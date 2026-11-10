import math
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import AIModel, LedgerEntry, Payment, TopupPackage, UsageEvent, User
from app.services import payhot
from app.services.llm import Usage


class InsufficientBalance(Exception):
    pass


def payments_enabled() -> bool:
    """The built-in mock credits sparks without money and is never available in production."""
    if settings.payment_provider == "payhot":
        return bool(settings.payhot_api_key and settings.payhot_webhook_secret)
    return settings.payment_provider == "mock" and not settings.is_production


def usage_cost(model: AIModel, usage: Usage) -> int:
    """Sparks to charge: prices are per 1M provider tokens; every billed call costs at least 1 ✦."""
    raw = usage.prompt_tokens * float(model.input_price) + usage.completion_tokens * float(model.output_price)
    return max(1, math.ceil(raw / 1_000_000))


def provider_cost_usd(model: AIModel, usage: Usage) -> float:
    return (usage.prompt_tokens * float(model.cost_input_usd)
            + usage.completion_tokens * float(model.cost_output_usd)) / 1_000_000


def record_usage(db: AsyncSession, user_id: int | None, kind: str, model: AIModel, usage: Usage,
                 charged: int = 0) -> None:
    """Log a provider call for cost monitoring. Caller commits."""
    db.add(UsageEvent(user_id=user_id, kind=kind, model_slug=model.slug, prompt_tokens=usage.prompt_tokens,
                      completion_tokens=usage.completion_tokens, cost_usd=provider_cost_usd(model, usage),
                      charged=charged))


async def apply(db: AsyncSession, user_id: int, amount: int, kind: str, description: str = "",
                meta: dict | None = None) -> int:
    """Atomically change a balance and record why. Caller commits."""
    balance = (await db.execute(
        update(User).where(User.id == user_id).values(balance=User.balance + amount).returning(User.balance)
    )).scalar_one()
    db.add(LedgerEntry(user_id=user_id, amount=amount, balance_after=balance, kind=kind,
                       description=description[:200], meta=meta or {}))
    return balance


async def ensure_can_spend(db: AsyncSession, user_id: int) -> int:
    balance = (await db.execute(select(User.balance).where(User.id == user_id))).scalar_one()
    if balance <= 0:
        raise InsufficientBalance
    return balance


# --- Top-ups -------------------------------------------------------------------------------------

def package_tokens(package: TopupPackage) -> int:
    return package.tokens + package.tokens * package.bonus_percent // 100


MIN_TOPUP_RUB = 100
MAX_TOPUP_RUB = 500_000

# Custom amounts get the same bonus ladder as packages: (min rubles, bonus %).
BONUS_LADDER = ((25_000, 30), (10_000, 25), (5_000, 20), (2_500, 15), (1_000, 10))


def custom_bonus(amount_rub: int) -> int:
    return next((bonus for threshold, bonus in BONUS_LADDER if amount_rub >= threshold), 0)


def custom_sparks(amount_rub: int) -> int:
    """1 ₽ = 1 ✦ plus the ladder bonus."""
    return amount_rub + amount_rub * custom_bonus(amount_rub) // 100


async def create_payment(db: AsyncSession, user: User, package: TopupPackage | None,
                         amount_rub: int | None = None, promo=None,
                         method: str | None = None, order_id: str | None = None) -> tuple[Payment, str | None]:
    """Returns the payment and a URL to send the user to (None when it settled instantly)."""
    if package is not None:
        price, sparks = package.price_kopeks, package_tokens(package)
    else:
        price, sparks = amount_rub * 100, custom_sparks(amount_rub)
    from app.services.growth import promo_bonus

    bonus = promo_bonus(promo, sparks)
    payment = Payment(user_id=user.id, package_id=package.id if package else None, amount_kopeks=price,
                      tokens=sparks + bonus, bonus_sparks=bonus, promo_id=promo.id if promo else None,
                      provider=settings.payment_provider)
    if order_id:
        payment.order_id = order_id
    db.add(payment)
    await db.flush()

    if settings.payment_provider == "payhot":
        # Commit first so the webhook always finds the row, even if it beats our response.
        payment.method = method or settings.payhot_methods[0]
        await db.commit()
        try:
            created = await payhot.client().create_payment(payment.order_id, price, payment.method)
        except payhot.PayHotError as error:
            payment.status, payment.error = "failed", str(error)[:300]
            await db.commit()
            raise
        payment.provider_payment_id = created.id
        payment.provider_status = created.status
        payment.checkout_url = created.checkout_url
        await db.commit()
        return payment, created.checkout_url

    if settings.payment_provider != "mock":
        raise RuntimeError("Платёжный провайдер не подключён")

    # mock: settles immediately so the full flow works locally.
    payment.provider_payment_id = f"mock-{uuid.uuid4()}"
    await settle(db, payment)
    await db.commit()
    return payment, None


async def apply_provider_status(db: AsyncSession, payment_id: int, provider_status: str) -> Payment | None:
    """Move a payment to the provider's status under a row lock, so the webhook and polling
    can't credit it twice. Caller commits."""
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id).with_for_update())
    if payment is None:
        return None
    payment.provider_status = provider_status
    payment.error = None
    if payment.status == "succeeded":
        return payment
    new = payhot.STATUS_MAP.get(provider_status)
    if new == "succeeded":
        await settle(db, payment)
    elif new and payment.status == "pending":
        payment.status = new
    return payment


async def refresh_payment(db: AsyncSession, payment: Payment) -> Payment:
    """Ask PayHot for the current status and apply it. Commits. Errors are kept on the payment
    (shown in the admin) instead of raised, so callers can just poll."""
    if payment.provider != "payhot" or not payment.provider_payment_id or payment.status != "pending":
        return payment
    try:
        provider_status = await payhot.client().get_status(payment.provider_payment_id)
    except payhot.PayHotError as error:
        payment.error = str(error)[:300]
        await db.commit()
        return payment
    await apply_provider_status(db, payment.id, provider_status)
    await db.commit()
    await db.refresh(payment)
    return payment


async def sync_pending(db: AsyncSession, user_id: int) -> int:
    """Re-check the user's recent pending payments (covers a missed webhook). Returns credited count."""
    if settings.payment_provider != "payhot":
        return 0
    since = datetime.now(UTC) - timedelta(days=2)
    pending = (await db.scalars(select(Payment).where(
        Payment.user_id == user_id, Payment.status == "pending", Payment.provider == "payhot",
        Payment.provider_payment_id.is_not(None), Payment.created_at >= since,
    ).order_by(Payment.id.desc()).limit(3))).all()
    credited = 0
    for item in pending:
        credited += (await refresh_payment(db, item)).status == "succeeded"
    return credited


async def settle(db: AsyncSession, payment: Payment) -> None:
    if payment.status == "succeeded":
        return
    payment.status = "succeeded"
    payment.paid_at = datetime.now(UTC)
    promo_note = f" (+{payment.bonus_sparks} ✦ по промокоду)" if payment.bonus_sparks else ""
    await apply(db, payment.user_id, payment.tokens, "topup", f"Пополнение #{payment.id}{promo_note}",
                {"payment_id": payment.id})
    from app.services.growth import on_payment_settled

    await on_payment_settled(db, payment)
