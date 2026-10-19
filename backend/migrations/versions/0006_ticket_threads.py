"""In-app support tickets: message threads instead of a single message + email reply.

Existing tickets keep their text and the support reply as the first two messages.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticket_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_staff", sa.Boolean(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_event", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ticket_messages_ticket_id", "ticket_messages", ["ticket_id"])

    op.add_column("support_tickets", sa.Column("user_unread", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("support_tickets", sa.Column("staff_unread", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("support_tickets", sa.Column("closed_by", sa.String(8), nullable=True))
    op.add_column("support_tickets", sa.Column("updated_at", sa.DateTime(timezone=True),
                                               server_default=sa.func.now(), nullable=False))
    op.create_index("ix_support_tickets_status", "support_tickets", ["status"])

    # Move old single-message tickets into threads.
    op.execute("""
        INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body, is_event, created_at)
        SELECT id, user_id, false, message, false, created_at FROM support_tickets
    """)
    op.execute("""
        INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body, is_event, created_at)
        SELECT id, NULL, true, reply, false, COALESCE(replied_at, created_at)
        FROM support_tickets WHERE reply IS NOT NULL
    """)
    op.execute("""
        UPDATE support_tickets SET
          status = CASE WHEN status = 'closed' THEN 'closed' WHEN reply IS NOT NULL THEN 'answered' ELSE 'open' END,
          closed_by = CASE WHEN status = 'closed' THEN 'staff' END,
          staff_unread = (status = 'open' AND reply IS NULL),
          user_unread = (reply IS NOT NULL),
          updated_at = COALESCE(replied_at, created_at)
    """)
    op.drop_column("support_tickets", "message")
    op.drop_column("support_tickets", "reply")
    op.drop_column("support_tickets", "replied_at")


def downgrade() -> None:
    op.add_column("support_tickets", sa.Column("message", sa.String(3000), nullable=False, server_default=""))
    op.add_column("support_tickets", sa.Column("reply", sa.String(5000), nullable=True))
    op.add_column("support_tickets", sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("""
        UPDATE support_tickets t SET message = LEFT(m.body, 3000) FROM (
          SELECT DISTINCT ON (ticket_id) ticket_id, body FROM ticket_messages
          WHERE NOT is_staff AND NOT is_event ORDER BY ticket_id, id) m
        WHERE m.ticket_id = t.id
    """)
    op.execute("""
        UPDATE support_tickets t SET reply = LEFT(m.body, 5000), replied_at = m.created_at FROM (
          SELECT DISTINCT ON (ticket_id) ticket_id, body, created_at FROM ticket_messages
          WHERE is_staff AND NOT is_event ORDER BY ticket_id, id DESC) m
        WHERE m.ticket_id = t.id
    """)
    op.execute("UPDATE support_tickets SET status = 'open' WHERE status = 'answered'")
    op.drop_index("ix_support_tickets_status", "support_tickets")
    for column in ("updated_at", "closed_by", "staff_unread", "user_unread"):
        op.drop_column("support_tickets", column)
    op.drop_table("ticket_messages")
