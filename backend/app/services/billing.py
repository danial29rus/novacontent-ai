import math
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import AIModel, LedgerEntry, Payment, TopupPackage, UsageEvent, User
from app.services.llm import Usage


class InsufficientBalance(Exception):
    pass


def payments_enabled() -> bool:
    """The built-in mock credits sparks without money and is never available in production."""
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


# Custom amounts get the same bonus ladder as packages: (min rubles, bonus %).
BONUS_LADDER = ((25_000, 30), (10_000, 25), (5_000, 20), (2_500, 15), (1_000, 10))


def custom_bonus(amount_rub: int) -> int:
    return next((bonus for threshold, bonus in BONUS_LADDER if amount_rub >= threshold), 0)


def custom_sparks(amount_rub: int) -> int:
    """1 ₽ = 1 ✦ plus the ladder bonus."""
    return amount_rub + amount_rub * custom_bonus(amount_rub) // 100


async def create_payment(db: AsyncSession, user: User, package: TopupPackage | None,
                         amount_rub: int | None = None, promo=None) -> tuple[Payment, str | None]:
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
    db.add(payment)
    await db.flush()

    if settings.payment_provider != "mock":
        raise RuntimeError("Платёжный провайдер не подключён")

    # mock: settles immediately so the full flow works locally.
    payment.provider_payment_id = f"mock-{uuid.uuid4()}"
    await settle(db, payment)
    await db.commit()
    return payment, None


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
