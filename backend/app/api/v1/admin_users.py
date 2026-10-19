"""Admin view of a single user: summary, full activity timeline and everything they created."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, AdminUser
from app.core.config import settings
from app.models import (
    Agent,
    AuditEvent,
    Chat,
    Document,
    Generation,
    KnowledgeBase,
    LedgerEntry,
    Message,
    Payment,
    Project,
    Session,
    SupportTicket,
    UsageEvent,
    User,
)
from app.schemas import AdminUserOut, MessageOut
from app.services.catalog import BY_SLUG
from app.services.studio import TOOLS

router = APIRouter(prefix="/admin/users", tags=["admin"])

PER_SOURCE = 300


async def _user(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден.")
    return user


def _event(at: datetime, kind: str, title: str, detail: str = "", ref: dict | None = None,
           amount: int | None = None) -> dict:
    return {"at": at, "type": kind, "title": title, "detail": detail[:300], "ref": ref, "amount": amount}


def _tool_title(tool: str) -> str:
    if tool in BY_SLUG:
        return f"{BY_SLUG[tool].emoji} {BY_SLUG[tool].title}"
    return TOOLS.get(tool, {}).get("title", tool)


@router.get("/{user_id}/summary")
async def summary(user_id: int, _: AdminUser, db: DB) -> dict:
    user = await _user(db, user_id)

    async def count(model, *where) -> int:
        return await db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    user_chats = select(Chat.id).where(Chat.user_id == user_id)
    spent = await db.scalar(select(func.coalesce(func.sum(-LedgerEntry.amount), 0))
                            .where(LedgerEntry.user_id == user_id, LedgerEntry.kind == "usage"))
    paid = await db.scalar(select(func.coalesce(func.sum(Payment.amount_kopeks), 0))
                           .where(Payment.user_id == user_id, Payment.status == "succeeded"))
    cost = await db.scalar(select(func.coalesce(func.sum(UsageEvent.cost_usd), 0)).where(UsageEvent.user_id == user_id))
    by_kind = (await db.execute(
        select(UsageEvent.kind, func.count(), func.coalesce(func.sum(UsageEvent.charged), 0))
        .where(UsageEvent.user_id == user_id).group_by(UsageEvent.kind)
    )).all()
    by_model = (await db.execute(
        select(UsageEvent.model_slug, func.count()).where(UsageEvent.user_id == user_id, UsageEvent.kind != "embedding")
        .group_by(UsageEvent.model_slug).order_by(func.count().desc())
    )).all()
    tools = (await db.execute(
        select(Generation.tool, func.count()).where(Generation.user_id == user_id)
        .group_by(Generation.tool).order_by(func.count().desc())
    )).all()
    last_login = await db.scalar(select(func.max(Session.created_at)).where(Session.user_id == user_id))

    return {
        "user": AdminUserOut.model_validate(user),
        "last_login": last_login,
        "counts": {
            "chats": await count(Chat, Chat.user_id == user_id),
            "messages": await count(Message, Message.chat_id.in_(user_chats), Message.role == "user"),
            "generations": await count(Generation, Generation.user_id == user_id),
            "agents": await count(Agent, Agent.user_id == user_id),
            "projects": await count(Project, Project.user_id == user_id),
            "knowledge_bases": await count(KnowledgeBase, KnowledgeBase.user_id == user_id),
            "logins": await count(Session, Session.user_id == user_id),
            "tickets": await count(SupportTicket, SupportTicket.user_id == user_id),
        },
        "spent_sparks": int(spent or 0),
        "paid_rub": (paid or 0) / 100,
        "cost_rub": round(float(cost or 0) * settings.usd_rub, 2),
        "by_kind": [{"kind": k, "calls": n, "charged": int(c)} for k, n, c in by_kind],
        "models": [{"model": m, "calls": n} for m, n in by_model],
        "tools": [{"tool": t, "title": _tool_title(t), "runs": n} for t, n in tools],
    }


@router.get("/{user_id}/activity")
async def activity(user_id: int, _: AdminUser, db: DB, limit: int = 300) -> list[dict]:
    """Everything the user did, newest first, merged from every table that records an action."""
    user = await _user(db, user_id)
    events = [_event(user.created_at, "account", "Регистрация", user.email)]

    for s in await db.scalars(select(Session).where(Session.user_id == user_id)
                              .order_by(Session.id.desc()).limit(PER_SOURCE)):
        events.append(_event(s.created_at, "login", "Вход в аккаунт", s.user_agent or ""))

    chats = {c.id: c for c in await db.scalars(select(Chat).where(Chat.user_id == user_id))}
    for c in chats.values():
        events.append(_event(c.created_at, "chat", "Создал чат", c.title, {"chat_id": c.id}))
    if chats:
        rows = await db.scalars(select(Message).where(Message.chat_id.in_(chats.keys()))
                                .order_by(Message.id.desc()).limit(PER_SOURCE))
        for m in rows:
            title = chats[m.chat_id].title
            if m.role == "user":
                events.append(_event(m.created_at, "message", f"Сообщение в «{title}»", m.content,
                                     {"chat_id": m.chat_id}))
            else:
                events.append(_event(m.created_at, "answer", f"Ответ {m.model_slug or 'AI'} в «{title}»",
                                     m.content, {"chat_id": m.chat_id}, -m.cost))

    for g in await db.scalars(select(Generation).where(Generation.user_id == user_id)
                              .order_by(Generation.id.desc()).limit(PER_SOURCE)):
        brief = "; ".join(f"{v}" for v in g.input.values())
        kind = "service" if g.tool in BY_SLUG else "studio"
        events.append(_event(g.created_at, kind, _tool_title(g.tool), brief, {"generation_id": g.id}, -g.cost))

    for a in await db.scalars(select(Agent).where(Agent.user_id == user_id)):
        events.append(_event(a.created_at, "agent", f"Создал агента {a.emoji} {a.name}", a.description))

    for p in await db.scalars(select(Project).where(Project.user_id == user_id)):
        events.append(_event(p.created_at, "project", f"Создал проект «{p.name}»", p.description,
                             {"project_id": p.id}))

    kbs = {k.id: k for k in await db.scalars(select(KnowledgeBase).where(KnowledgeBase.user_id == user_id))}
    for k in kbs.values():
        events.append(_event(k.created_at, "knowledge", f"Создал базу знаний «{k.name}»", k.description))
    if kbs:
        for d in await db.scalars(select(Document).where(Document.knowledge_base_id.in_(kbs.keys()))):
            events.append(_event(d.created_at, "document", f"Загрузил документ в «{kbs[d.knowledge_base_id].name}»",
                                 f"{d.filename} · {d.status} · {d.chunks_count} фрагм."))

    for p in await db.scalars(select(Payment).where(Payment.user_id == user_id)):
        events.append(_event(p.created_at, "payment", f"Оплата {p.amount_kopeks / 100:.0f} ₽ · {p.status}",
                             f"{p.provider}", None, p.tokens if p.status == "succeeded" else None))

    for t in await db.scalars(select(SupportTicket).where(SupportTicket.user_id == user_id)):
        events.append(_event(t.created_at, "ticket", f"Обращение: {t.subject}", f"статус: {t.status}"))

    for e in await db.scalars(select(LedgerEntry).where(LedgerEntry.user_id == user_id,
                                                        LedgerEntry.kind.in_(("admin", "welcome", "refund")))):
        events.append(_event(e.created_at, "balance", e.description or e.kind, f"баланс после: {e.balance_after} ✦",
                             None, e.amount))

    for a in await db.scalars(select(AuditEvent).where(AuditEvent.details["user_id"].astext == str(user_id))):
        events.append(_event(a.created_at, "admin", f"Действие админа: {a.action}",
                             ", ".join(f"{k}={v}" for k, v in a.details.items() if k != "user_id")))

    events.sort(key=lambda e: e["at"], reverse=True)
    return events[: min(limit, 1000)]


@router.get("/{user_id}/content")
async def content(user_id: int, _: AdminUser, db: DB) -> dict:
    """Chats, projects, agents and knowledge bases the user owns."""
    await _user(db, user_id)
    msg_count = (select(func.count(Message.id)).where(Message.chat_id == Chat.id).scalar_subquery())
    chats = (await db.execute(select(Chat, msg_count).where(Chat.user_id == user_id)
                              .order_by(Chat.updated_at.desc()))).all()
    doc_count = (select(func.count(Document.id)).where(Document.knowledge_base_id == KnowledgeBase.id)
                 .scalar_subquery())
    kbs = (await db.execute(select(KnowledgeBase, doc_count).where(KnowledgeBase.user_id == user_id))).all()
    return {
        "chats": [{"id": c.id, "title": c.title, "messages": n, "updated_at": c.updated_at,
                   "has_summary": bool(c.summary)} for c, n in chats],
        "projects": [{"id": p.id, "name": p.name, "description": p.description, "tone": p.tone,
                      "brand_context": p.brand_context, "created_at": p.created_at}
                     for p in await db.scalars(select(Project).where(Project.user_id == user_id))],
        "agents": [{"id": a.id, "name": a.name, "emoji": a.emoji, "description": a.description,
                    "system_prompt": a.system_prompt, "created_at": a.created_at}
                   for a in await db.scalars(select(Agent).where(Agent.user_id == user_id))],
        "knowledge_bases": [{"id": k.id, "name": k.name, "documents": n, "created_at": k.created_at} for k, n in kbs],
    }


@router.get("/{user_id}/chats/{chat_id}", response_model=list[MessageOut])
async def chat_messages(user_id: int, chat_id: int, _: AdminUser, db: DB) -> list[Message]:
    chat = await db.get(Chat, chat_id)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден.")
    return list(await db.scalars(select(Message).where(Message.chat_id == chat_id).order_by(Message.id)))


@router.get("/{user_id}/generations/{generation_id}")
async def generation(user_id: int, generation_id: int, _: AdminUser, db: DB) -> dict:
    g = await db.get(Generation, generation_id)
    if g is None or g.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено.")
    return {"id": g.id, "title": _tool_title(g.tool), "input": g.input, "output": g.output, "cost": g.cost,
            "model_slug": g.model_slug, "created_at": g.created_at}
