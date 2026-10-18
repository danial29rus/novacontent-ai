from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AIModel(TimestampMixin, Base):
    """A model users can pick.

    input/output_price: Sparks (✦) charged per 1M provider tokens.
    cost_input/output_usd: what the provider charges us per 1M tokens, for margin monitoring.
    """

    __tablename__ = "ai_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    provider: Mapped[str] = mapped_column(String(32))  # openai | anthropic
    provider_model: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    badge: Mapped[str | None] = mapped_column(String(24))
    context_window: Mapped[int] = mapped_column(Integer, default=128_000)
    input_price: Mapped[float] = mapped_column(Numeric(12, 3), default=150)
    output_price: Mapped[float] = mapped_column(Numeric(12, 3), default=600)
    cost_input_usd: Mapped[float] = mapped_column(Numeric(10, 4), default=0)
    cost_output_usd: Mapped[float] = mapped_column(Numeric(10, 4), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=100)


class LedgerEntry(TimestampMixin, Base):
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(String(16))  # welcome | topup | usage | admin | refund
    description: Mapped[str] = mapped_column(String(200), default="")
    meta: Mapped[dict] = mapped_column(default=dict)


class TopupPackage(TimestampMixin, Base):
    __tablename__ = "topup_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True)
    title: Mapped[str] = mapped_column(String(80))
    tokens: Mapped[int] = mapped_column(BigInteger)
    price_kopeks: Mapped[int] = mapped_column(Integer)
    bonus_percent: Mapped[int] = mapped_column(Integer, default=0)
    highlight: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    package_id: Mapped[int | None] = mapped_column(ForeignKey("topup_packages.id", ondelete="SET NULL"))
    amount_kopeks: Mapped[int] = mapped_column(Integer)
    tokens: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | succeeded | canceled
    provider: Mapped[str] = mapped_column(String(32))
    provider_payment_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    promo_id: Mapped[int | None] = mapped_column(ForeignKey("promo_codes.id", ondelete="SET NULL"))
    bonus_sparks: Mapped[int] = mapped_column(BigInteger, default=0)  # from the promo, included in `tokens`


class UsageEvent(TimestampMixin, Base):
    """Every provider call with its real cost, including ones users aren't billed for (summaries, embeddings)."""

    __tablename__ = "usage_events"
    __table_args__ = (Index("ix_usage_events_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # chat | studio | service | summary | embedding
    model_slug: Mapped[str] = mapped_column(String(64))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    charged: Mapped[int] = mapped_column(BigInteger, default=0)  # sparks billed to the user
