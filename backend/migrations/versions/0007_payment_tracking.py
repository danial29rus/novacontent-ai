"""Payment tracking for PayHot: provider status, method, checkout link, last error, updated_at.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("provider_status", sa.String(32), nullable=True))
    op.add_column("payments", sa.Column("method", sa.String(32), nullable=True))
    op.add_column("payments", sa.Column("checkout_url", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("error", sa.String(300), nullable=True))
    op.add_column("payments", sa.Column("updated_at", sa.DateTime(timezone=True),
                                        server_default=sa.func.now(), nullable=False))
    op.create_index("ix_payments_status", "payments", ["status"])


def downgrade() -> None:
    op.drop_index("ix_payments_status", "payments")
    for column in ("updated_at", "error", "checkout_url", "method", "provider_status"):
        op.drop_column("payments", column)
