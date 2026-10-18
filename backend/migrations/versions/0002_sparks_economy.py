"""Sparks (✦) economy: prices per 1M tokens, new top-up packages, provider cost tracking.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# slug: (input ✦/1M, output ✦/1M, provider input $/1M, provider output $/1M)
MODELS = {
    "gpt-4.1-mini": (150, 600, 0.4, 1.6),
    "gpt-4.1": (750, 3000, 2, 8),
    "claude-haiku": (300, 1500, 1, 5),
    "claude-sonnet": (900, 4500, 3, 15),
}
# slug: (title, sparks, price kopeks, bonus %, highlight)
PACKAGES = {
    "start": ("Старт", 500, 50_000, 0, False),
    "basic": ("Базовый", 1_000, 100_000, 10, False),
    "pro": ("Про", 2_500, 250_000, 15, True),
    "creator": ("Креатор", 5_000, 500_000, 20, False),
    "studio": ("Студия", 10_000, 1_000_000, 25, False),
    "business": ("Бизнес", 25_000, 2_500_000, 30, False),
}


def upgrade() -> None:
    op.alter_column("ai_models", "input_price", type_=sa.Numeric(12, 3))
    op.alter_column("ai_models", "output_price", type_=sa.Numeric(12, 3))
    op.add_column("ai_models", sa.Column("cost_input_usd", sa.Numeric(10, 4), nullable=False, server_default="0"))
    op.add_column("ai_models", sa.Column("cost_output_usd", sa.Numeric(10, 4), nullable=False, server_default="0"))

    op.create_table(
        "usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("model_slug", sa.String(64), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False),
        sa.Column("charged", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_usage_events_user_id", "usage_events", ["user_id"])
    op.create_index("ix_usage_events_kind", "usage_events", ["kind"])
    op.create_index("ix_usage_events_created_at", "usage_events", ["created_at"])

    for slug, (inp, out, cin, cout) in MODELS.items():
        op.execute(sa.text("UPDATE ai_models SET input_price=:i, output_price=:o, cost_input_usd=:ci, "
                           "cost_output_usd=:co WHERE slug=:s").bindparams(i=inp, o=out, ci=cin, co=cout, s=slug))

    op.execute("UPDATE topup_packages SET is_active=false")
    for slug, (title, sparks, price, bonus, highlight) in PACKAGES.items():
        op.execute(sa.text(
            "INSERT INTO topup_packages (slug, title, tokens, price_kopeks, bonus_percent, highlight, is_active) "
            "VALUES (:s, :t, :n, :p, :b, :h, true) ON CONFLICT (slug) DO UPDATE SET title=:t, tokens=:n, "
            "price_kopeks=:p, bonus_percent=:b, highlight=:h, is_active=true"
        ).bindparams(s=slug, t=title, n=sparks, p=price, b=bonus, h=highlight))

    # Old balances were in raw tokens (~1000 per spark).
    op.execute("UPDATE users SET balance = balance / 1000")
    op.execute("UPDATE ledger_entries SET amount = amount / 1000, balance_after = balance_after / 1000")
    op.execute("UPDATE payments SET tokens = tokens / 1000 WHERE created_at < now()")


def downgrade() -> None:
    op.execute("UPDATE users SET balance = balance * 1000")
    op.execute("UPDATE ledger_entries SET amount = amount * 1000, balance_after = balance_after * 1000")
    op.drop_table("usage_events")
    op.drop_column("ai_models", "cost_output_usd")
    op.drop_column("ai_models", "cost_input_usd")
