"""Payment order_id: our uuid4, sent to PayHot as merchant_order_reference.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("order_id", sa.String(36), nullable=True))
    op.execute("UPDATE payments SET order_id = gen_random_uuid()::text WHERE order_id IS NULL")
    op.alter_column("payments", "order_id", nullable=False)
    op.create_unique_constraint("uq_payments_order_id", "payments", ["order_id"])


def downgrade() -> None:
    op.drop_constraint("uq_payments_order_id", "payments")
    op.drop_column("payments", "order_id")
