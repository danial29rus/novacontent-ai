"""Model lineup: only OpenAI GPT-5.6 Terra and GPT-6 Luna; everything else is switched off.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# slug, provider id, title, description, badge, context, ✦ in/out per 1M, $ in/out per 1M, default, sort
MODELS = [
    ("gpt-6-luna", "gpt-6-luna", "GPT-6 Luna", "Быстрая и экономная модель OpenAI для повседневных задач.",
     "Быстрая", 400_000, 40, 200, 0.10, 0.50, True, 10),
    ("gpt-5.6-terra", "gpt-5.6-terra", "GPT-5.6 Terra",
     "Сильная модель OpenAI: длинные тексты, стратегия, анализ и код.", "Умная", 400_000, 750, 4500, 2, 12, False, 20),
]


def upgrade() -> None:
    op.execute("UPDATE ai_models SET is_active = false, is_default = false")
    for slug, pid, title, desc, badge, ctx, inp, out, cin, cout, default, sort in MODELS:
        op.execute(sa.text(
            "INSERT INTO ai_models (slug, provider, provider_model, title, description, badge, context_window, "
            "input_price, output_price, cost_input_usd, cost_output_usd, is_active, is_default, sort) "
            "VALUES (:s, 'openai', :p, :t, :d, :b, :c, :i, :o, :ci, :co, true, :df, :so) "
            "ON CONFLICT (slug) DO UPDATE SET provider_model=:p, title=:t, description=:d, badge=:b, "
            "context_window=:c, input_price=:i, output_price=:o, cost_input_usd=:ci, cost_output_usd=:co, "
            "is_active=true, is_default=:df, sort=:so"
        ).bindparams(s=slug, p=pid, t=title, d=desc, b=badge, c=ctx, i=inp, o=out, ci=cin, co=cout, df=default,
                     so=sort))
    # Chats and agents pinned to a retired model fall back to the default one.
    op.execute("UPDATE chats SET model_id = NULL WHERE model_id IN (SELECT id FROM ai_models WHERE NOT is_active)")
    op.execute("UPDATE agents SET model_id = NULL WHERE model_id IN (SELECT id FROM ai_models WHERE NOT is_active)")


def downgrade() -> None:
    op.execute("UPDATE ai_models SET is_active = (slug NOT IN ('gpt-6-luna', 'gpt-5.6-terra'))")
    op.execute("UPDATE ai_models SET is_default = (slug = 'gpt-4.1-mini')")
