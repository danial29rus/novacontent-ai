from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Project(TimestampMixin, Base):
    """A workspace with brand memory that feeds every chat and generation inside it."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(280), default="")
    brand_context: Mapped[str] = mapped_column(Text, default="")
    tone: Mapped[str] = mapped_column(String(80), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ContentPack(TimestampMixin, Base):
    __tablename__ = "content_packs"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str | None] = mapped_column(String(32), unique=True)
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(280))
    emoji: Mapped[str] = mapped_column(String(8), default="✦")
    steps: Mapped[list] = mapped_column(default=list)  # [{title, tool, prompt}]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProjectPack(TimestampMixin, Base):
    __tablename__ = "project_packs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_pack_id: Mapped[int | None] = mapped_column(ForeignKey("content_packs.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(280), default="")
    steps: Mapped[list] = mapped_column(default=list)


class Generation(TimestampMixin, Base):
    """One-shot Studio output (post, plan, rewrite…), saved to the library."""

    __tablename__ = "generations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    tool: Mapped[str] = mapped_column(String(20))
    input: Mapped[dict] = mapped_column(default=dict)
    output: Mapped[str] = mapped_column(Text, default="")
    model_slug: Mapped[str] = mapped_column(String(64))
    cost: Mapped[int] = mapped_column(Integer, default=0)
