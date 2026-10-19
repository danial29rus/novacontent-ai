"""In-app support tickets. Users talk to support inside the site; no email involved."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, AdminUser, CurrentUser, RateLimited
from app.models import AuditEvent, SupportTicket, TicketMessage, User

router = APIRouter(tags=["support"])


class TicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=120)
    message: str = Field(min_length=2, max_length=5000)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class TicketOut(BaseModel):
    id: int
    subject: str
    status: Literal["open", "answered", "closed"]
    unread: bool
    closed_by: str | None
    created_at: datetime
    updated_at: datetime
    last_message: str = ""
    user_email: str | None = None
    user_name: str | None = None
    user_id: int | None = None


class MessageOut(BaseModel):
    id: int
    is_staff: bool
    is_event: bool
    body: str
    author: str
    created_at: datetime


# --- shared ------------------------------------------------------------------------------------

def _out(ticket: SupportTicket, *, staff: bool, last: str = "", user: User | None = None) -> TicketOut:
    return TicketOut(
        id=ticket.id, subject=ticket.subject, status=ticket.status, closed_by=ticket.closed_by,
        unread=ticket.staff_unread if staff else ticket.user_unread,
        created_at=ticket.created_at, updated_at=ticket.updated_at, last_message=last[:160],
        user_email=user.email if user else None, user_name=user.name if user else None,
        user_id=user.id if user else None,
    )


async def _list(db: AsyncSession, query, *, staff: bool) -> list[TicketOut]:
    last_body = (select(TicketMessage.body).where(TicketMessage.ticket_id == SupportTicket.id,
                                                  TicketMessage.is_event.is_(False))
                 .order_by(TicketMessage.id.desc()).limit(1).scalar_subquery())
    rows = (await db.execute(query.add_columns(last_body, User).join(User, User.id == SupportTicket.user_id)
                             .order_by(SupportTicket.updated_at.desc()).limit(200))).all()
    return [_out(t, staff=staff, last=last or "", user=u if staff else None) for t, last, u in rows]


async def _thread(db: AsyncSession, ticket: SupportTicket) -> list[MessageOut]:
    rows = (await db.execute(
        select(TicketMessage, User.name).outerjoin(User, User.id == TicketMessage.author_id)
        .where(TicketMessage.ticket_id == ticket.id).order_by(TicketMessage.id)
    )).all()
    return [MessageOut(id=m.id, is_staff=m.is_staff, is_event=m.is_event, body=m.body, created_at=m.created_at,
                       author="Поддержка Nova" if m.is_staff else (name or "Пользователь")) for m, name in rows]


async def _post(db: AsyncSession, ticket: SupportTicket, author: User, body: str, *, staff: bool) -> None:
    if ticket.status == "closed":  # writing into a closed ticket reopens it
        db.add(TicketMessage(ticket_id=ticket.id, author_id=author.id, is_staff=staff, is_event=True,
                             body="Обращение открыто снова"))
        ticket.closed_by = None
    db.add(TicketMessage(ticket_id=ticket.id, author_id=author.id, is_staff=staff, body=body.strip()))
    ticket.status = "answered" if staff else "open"
    ticket.user_unread, ticket.staff_unread = (True, False) if staff else (False, True)
    ticket.updated_at = func.now()


async def _set_closed(db: AsyncSession, ticket: SupportTicket, author: User, close: bool, *, staff: bool) -> None:
    if close == (ticket.status == "closed"):
        return
    who = "поддержкой" if staff else "пользователем"
    db.add(TicketMessage(ticket_id=ticket.id, author_id=author.id, is_staff=staff, is_event=True,
                         body=f"Обращение {'закрыто' if close else 'открыто снова'} {who}"))
    ticket.status = "closed" if close else "open"
    ticket.closed_by = ("staff" if staff else "user") if close else None
    # The other side should notice the change.
    if staff:
        ticket.user_unread = True
    else:
        ticket.staff_unread = not close
    ticket.updated_at = func.now()


# --- user --------------------------------------------------------------------------------------

async def _own(db: AsyncSession, ticket_id: int, user: User) -> SupportTicket:
    ticket = await db.get(SupportTicket, ticket_id)
    if ticket is None or ticket.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Обращение не найдено.")
    return ticket


@router.get("/tickets", response_model=list[TicketOut])
async def my_tickets(user: CurrentUser, db: DB) -> list[TicketOut]:
    return await _list(db, select(SupportTicket).where(SupportTicket.user_id == user.id), staff=False)


@router.get("/tickets/unread")
async def my_unread(user: CurrentUser, db: DB) -> dict:
    count = await db.scalar(select(func.count(SupportTicket.id))
                            .where(SupportTicket.user_id == user.id, SupportTicket.user_unread))
    return {"count": count or 0}


@router.post("/tickets", response_model=TicketOut, status_code=201, dependencies=[RateLimited])
async def create_ticket(body: TicketIn, user: CurrentUser, db: DB) -> TicketOut:
    open_count = await db.scalar(select(func.count(SupportTicket.id)).where(
        SupportTicket.user_id == user.id, SupportTicket.status != "closed"))
    if (open_count or 0) >= 10:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "У вас уже 10 открытых обращений. Дождитесь ответа или закройте ненужные.")
    ticket = SupportTicket(user_id=user.id, subject=body.subject.strip(), status="open", staff_unread=True)
    db.add(ticket)
    await db.flush()
    db.add(TicketMessage(ticket_id=ticket.id, author_id=user.id, is_staff=False, body=body.message.strip()))
    await db.commit()
    await db.refresh(ticket)
    return _out(ticket, staff=False, last=body.message)


@router.get("/tickets/{ticket_id}")
async def my_ticket(ticket_id: int, user: CurrentUser, db: DB) -> dict:
    ticket = await _own(db, ticket_id, user)
    if ticket.user_unread:
        ticket.user_unread = False
        await db.commit()
        await db.refresh(ticket)
    return {"ticket": _out(ticket, staff=False), "messages": await _thread(db, ticket)}


@router.post("/tickets/{ticket_id}/messages", status_code=201, dependencies=[RateLimited])
async def my_reply(ticket_id: int, body: MessageIn, user: CurrentUser, db: DB) -> dict:
    ticket = await _own(db, ticket_id, user)
    await _post(db, ticket, user, body.body, staff=False)
    await db.commit()
    return {"ok": True}


@router.post("/tickets/{ticket_id}/close", status_code=204)
async def my_close(ticket_id: int, user: CurrentUser, db: DB) -> None:
    await _set_closed(db, await _own(db, ticket_id, user), user, True, staff=False)
    await db.commit()


@router.post("/tickets/{ticket_id}/reopen", status_code=204)
async def my_reopen(ticket_id: int, user: CurrentUser, db: DB) -> None:
    await _set_closed(db, await _own(db, ticket_id, user), user, False, staff=False)
    await db.commit()


# --- admin -------------------------------------------------------------------------------------

async def _any(db: AsyncSession, ticket_id: int) -> SupportTicket:
    ticket = await db.get(SupportTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Обращение не найдено.")
    return ticket


@router.get("/admin/tickets", response_model=list[TicketOut])
async def all_tickets(_: AdminUser, db: DB, status_filter: str = "active", q: str | None = None) -> list[TicketOut]:
    query = select(SupportTicket)
    if status_filter == "active":
        query = query.where(SupportTicket.status != "closed")
    elif status_filter in ("open", "answered", "closed"):
        query = query.where(SupportTicket.status == status_filter)
    if q:
        query = query.where(or_(SupportTicket.subject.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    return await _list(db, query, staff=True)


@router.get("/admin/tickets/counts")
async def ticket_counts(_: AdminUser, db: DB) -> dict:
    rows = dict((await db.execute(select(SupportTicket.status, func.count()).group_by(SupportTicket.status))).all())
    unread = await db.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.staff_unread))
    return {"open": rows.get("open", 0), "answered": rows.get("answered", 0), "closed": rows.get("closed", 0),
            "unread": unread or 0}


@router.get("/admin/tickets/{ticket_id}")
async def admin_ticket(ticket_id: int, _: AdminUser, db: DB) -> dict:
    ticket = await _any(db, ticket_id)
    if ticket.staff_unread:
        ticket.staff_unread = False
        await db.commit()
        await db.refresh(ticket)
    user = await db.get(User, ticket.user_id)
    return {"ticket": _out(ticket, staff=True, user=user), "messages": await _thread(db, ticket)}


@router.post("/admin/tickets/{ticket_id}/messages", status_code=201)
async def admin_reply(ticket_id: int, body: MessageIn, actor: AdminUser, db: DB) -> dict:
    ticket = await _any(db, ticket_id)
    await _post(db, ticket, actor, body.body, staff=True)
    db.add(AuditEvent(actor_id=actor.id, action="ticket_reply", details={"ticket_id": ticket.id,
                                                                         "user_id": ticket.user_id}))
    await db.commit()
    return {"ok": True}


@router.post("/admin/tickets/{ticket_id}/close", status_code=204)
async def admin_close(ticket_id: int, actor: AdminUser, db: DB) -> None:
    await _set_closed(db, await _any(db, ticket_id), actor, True, staff=True)
    await db.commit()


@router.post("/admin/tickets/{ticket_id}/reopen", status_code=204)
async def admin_reopen(ticket_id: int, actor: AdminUser, db: DB) -> None:
    await _set_closed(db, await _any(db, ticket_id), actor, False, staff=True)
    await db.commit()
