"""Promo codes, referral program and sign-up attribution."""

import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Payment, PromoCode, PromoRedemption, ReferralReward, User

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion


class PromoError(Exception):
    pass


def normalize(code: str | None) -> str:
    return (code or "").strip().upper()[:40]


def new_ref_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


async def ensure_ref_code(db: AsyncSession, user: User) -> str:
    if not user.ref_code:
        user.ref_code = new_ref_code()
        await db.commit()
    return user.ref_code


async def find_promo(db: AsyncSession, code: str, user: User, *, kind: str | None = None,
                     amount_rub: int | None = None) -> PromoCode:
    """Return a promo this user may use right now, or raise PromoError with a human message."""
    promo = await db.scalar(select(PromoCode).where(PromoCode.code == normalize(code)))
    if promo is None or not promo.is_active:
        raise PromoError("Промокод не найден.")
    if promo.expires_at and promo.expires_at < datetime.now(UTC):
        raise PromoError("Срок действия промокода истёк.")
    if promo.max_uses is not None and promo.uses >= promo.max_uses:
        raise PromoError("Промокод больше не действует: лимит активаций исчерпан.")
    if kind and promo.kind != kind:
        raise PromoError("Этот промокод применяется при оплате." if promo.kind == "topup"
                         else "Это подарочный промокод — активируйте его на странице баланса.")
    if await db.scalar(select(PromoRedemption.id).where(PromoRedemption.promo_id == promo.id,
                                                        PromoRedemption.user_id == user.id)):
        raise PromoError("Вы уже использовали этот промокод.")
    if promo.new_users_only and await db.scalar(
        select(Payment.id).where(Payment.user_id == user.id, Payment.status == "succeeded")
    ):
        raise PromoError("Промокод только для новых клиентов.")
    if promo.kind == "topup" and amount_rub is not None and amount_rub < promo.min_topup_rub:
        raise PromoError(f"Промокод действует при оплате от {promo.min_topup_rub} ₽.")
    return promo


def promo_bonus(promo: PromoCode | None, sparks: int) -> int:
    return sparks * promo.value // 100 if promo and promo.kind == "topup" else 0


async def redeem_gift(db: AsyncSession, user: User, code: str) -> tuple[PromoCode, int]:
    from app.services.billing import apply

    promo = await find_promo(db, code, user, kind="gift")
    promo.uses += 1
    db.add(PromoRedemption(promo_id=promo.id, user_id=user.id, sparks=promo.value))
    balance = await apply(db, user.id, promo.value, "promo", f"Промокод {promo.code}", {"promo_id": promo.id})
    await db.commit()
    return promo, balance


async def on_payment_settled(db: AsyncSession, payment: Payment) -> None:
    """Count the promo use and pay the referrer their share. Caller commits."""
    from app.services.billing import apply

    if payment.promo_id:
        promo = await db.get(PromoCode, payment.promo_id)
        exists = await db.scalar(select(PromoRedemption.id).where(
            PromoRedemption.promo_id == payment.promo_id, PromoRedemption.user_id == payment.user_id))
        if promo and not exists:
            promo.uses += 1
            db.add(PromoRedemption(promo_id=promo.id, user_id=payment.user_id, payment_id=payment.id,
                                   sparks=payment.bonus_sparks))

    payer = await db.get(User, payment.user_id)
    if payer and payer.referred_by_id and settings.referral_percent > 0:
        reward = (payment.tokens - payment.bonus_sparks) * settings.referral_percent // 100
        if reward > 0:
            db.add(ReferralReward(referrer_id=payer.referred_by_id, referred_id=payer.id,
                                  payment_id=payment.id, sparks=reward))
            await apply(db, payer.referred_by_id, reward, "referral",
                        f"Реферальный бонус: оплата друга {payer.name}", {"payment_id": payment.id})


async def on_signup(db: AsyncSession, user: User, *, ref: str | None, promo: str | None,
                    utm_source: str | None, utm_campaign: str | None) -> list[str]:
    """Attribute the sign-up and grant referral / promo bonuses. Returns notices for the UI. Caller commits."""
    from app.services.billing import apply

    notices: list[str] = []
    user.ref_code = new_ref_code()
    user.signup_campaign = (utm_campaign or "")[:100]
    source = (utm_source or "").strip()[:64]

    referrer = await db.scalar(select(User).where(User.ref_code == normalize(ref))) if ref else None
    if referrer and referrer.id != user.id:
        user.referred_by_id = referrer.id
        source = source or "referral"
        if settings.referral_signup_bonus:
            await apply(db, user.id, settings.referral_signup_bonus, "referral",
                        f"Бонус за регистрацию по приглашению {referrer.name}")
            notices.append(f"+{settings.referral_signup_bonus} ✦ за регистрацию по приглашению")

    if promo:
        user.signup_promo = normalize(promo)
        try:
            found = await find_promo(db, promo, user)
            source = source or found.source or f"promo:{found.code}"
            if found.kind == "gift":
                found.uses += 1
                db.add(PromoRedemption(promo_id=found.id, user_id=user.id, sparks=found.value))
                await apply(db, user.id, found.value, "promo", f"Промокод {found.code}", {"promo_id": found.id})
                notices.append(f"Промокод {found.code}: +{found.value} ✦")
            else:
                notices.append(f"Промокод {found.code} даст +{found.value}% при пополнении")
        except PromoError as error:
            notices.append(str(error))

    user.signup_source = source or "direct"
    return notices
