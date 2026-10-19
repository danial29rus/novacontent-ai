from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class SupportTicket(TimestampMixin, Base):
    """An in-app support conversation.

    status: open (waiting for support) | answered (waiting for the user) | closed.
    The *_unread flags drive the badges: the other side wrote something not yet seen.
    """

    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    user_unread: Mapped[bool] = mapped_column(Boolean, default=False)
    staff_unread: Mapped[bool] = mapped_column(Boolean, default=True)
    closed_by: Mapped[str | None] = mapped_column(String(8))  # user | staff
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TicketMessage(TimestampMixin, Base):
    __tablename__ = "ticket_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    # Service lines like "Тикет закрыт пользователем" are shown differently.
    is_event: Mapped[bool] = mapped_column(Boolean, default=False)
