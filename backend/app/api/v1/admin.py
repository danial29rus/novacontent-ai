import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select, update

from app.api.deps import DB, AdminUser
from app.core.config import settings
from app.models import AIModel, AuditEvent, LedgerEntry, Message, Payment, SupportTicket, UsageEvent, User
from app.schemas import (
    AdminBalanceIn,
    AdminUserOut,
    AdminUserUpdate,
    AIModelAdmin,
    AIModelUpdate,
    LedgerOut,
)
from app.services import billing, mailer

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
async def overview(_: AdminUser, db: DB, days: int = 30) -> dict:
    since = datetime.now(UTC) - timedelta(days=min(days, 180))
    day = func.date_trunc("day", LedgerEntry.created_at)
    daily = (await db.execute(
        select(day.label("day"),
               func.sum(-LedgerEntry.amount).filter(LedgerEntry.kind == "usage").label("spent"),
               func.sum(LedgerEntry.amount).filter(LedgerEntry.kind == "topup").label("topups"))
        .where(LedgerEntry.created_at >= since).group_by(day).order_by(day)
    )).all()
    by_model = (await db.execute(
        select(Message.model_slug, func.count(Message.id), func.sum(Message.cost))
        .where(Message.role == "assistant", Message.created_at >= since)
        .group_by(Message.model_slug).order_by(func.sum(Message.cost).desc())
    )).all()
    revenue = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount_kopeks), 0))
        .where(Payment.status == "succeeded", Payment.paid_at >= since)
    )
    return {
        "users": await db.scalar(select(func.count(User.id))),
        "new_users": await db.scalar(select(func.count(User.id)).where(User.created_at >= since)),
        "active_users": await db.scalar(select(func.count(User.id)).where(User.last_seen_at >= since)),
        "messages": await db.scalar(select(func.count(Message.id)).where(Message.created_at >= since)),
        "revenue_kopeks": revenue,
        "open_tickets": await db.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.status == "open")),
        "daily": [{"day": r.day.date().isoformat(), "spent": int(r.spent or 0), "topups": int(r.topups or 0)}
                  for r in daily],
        "by_model": [{"model": m or "—", "messages": n, "tokens": int(c or 0)} for m, n, c in by_model],
    }


@router.get("/costs")
async def costs(_: AdminUser, db: DB, days: int = 30) -> dict:
    """What providers cost us vs. what users were charged and what they paid."""
    since = datetime.now(UTC) - timedelta(days=min(days, 365))
    rate = settings.usd_rub
    recent = UsageEvent.created_at >= since

    totals = (await db.execute(select(
        func.coalesce(func.sum(UsageEvent.cost_usd), 0), func.coalesce(func.sum(UsageEvent.charged), 0),
        func.count(UsageEvent.id),
        func.coalesce(func.sum(UsageEvent.prompt_tokens + UsageEvent.completion_tokens), 0),
    ).where(recent))).one()
    revenue = await db.scalar(select(func.coalesce(func.sum(Payment.amount_kopeks), 0))
                              .where(Payment.status == "succeeded", Payment.paid_at >= since)) or 0
    cost_rub = float(totals[0]) * rate
    revenue_rub = revenue / 100

    def grouped(column):
        return select(column, func.count(UsageEvent.id), func.sum(UsageEvent.prompt_tokens),
                      func.sum(UsageEvent.completion_tokens), func.sum(UsageEvent.cost_usd),
                      func.sum(UsageEvent.charged)).where(recent).group_by(column).order_by(
                          func.sum(UsageEvent.cost_usd).desc())

    def rows(result) -> list[dict]:
        return [{"key": k or "—", "calls": n, "prompt_tokens": int(p or 0), "completion_tokens": int(c or 0),
                 "cost_rub": round(float(u or 0) * rate, 2), "charged": int(ch or 0),
                 "margin_rub": round(int(ch or 0) - float(u or 0) * rate, 2)} for k, n, p, c, u, ch in result]

    day = func.date_trunc("day", UsageEvent.created_at)
    daily = (await db.execute(select(day, func.sum(UsageEvent.cost_usd), func.sum(UsageEvent.charged))
                              .where(recent).group_by(day).order_by(day))).all()
    top_users = (await db.execute(
        select(User.email, func.sum(UsageEvent.cost_usd), func.sum(UsageEvent.charged), func.count(UsageEvent.id))
        .join(User, User.id == UsageEvent.user_id).where(recent)
        .group_by(User.email).order_by(func.sum(UsageEvent.cost_usd).desc()).limit(10)
    )).all()
    outstanding = await db.scalar(select(func.coalesce(func.sum(User.balance), 0)))

    return {
        "usd_rub": rate,
        "cost_rub": round(cost_rub, 2),
        "charged_sparks": int(totals[1]),
        "revenue_rub": revenue_rub,
        "gross_margin_rub": round(revenue_rub - cost_rub, 2),
        "calls": totals[2],
        "tokens": int(totals[3]),
        "outstanding_sparks": int(outstanding or 0),
        "by_kind": rows((await db.execute(grouped(UsageEvent.kind))).all()),
        "by_model": rows((await db.execute(grouped(UsageEvent.model_slug))).all()),
        "daily": [{"day": d.date().isoformat(), "cost_rub": round(float(u or 0) * rate, 2), "charged": int(c or 0)}
                  for d, u, c in daily],
        "top_users": [{"email": e, "cost_rub": round(float(u or 0) * rate, 2), "charged": int(c or 0), "calls": n}
                      for e, u, c, n in top_users],
    }


@router.get("/users", response_model=list[AdminUserOut])
async def users(_: AdminUser, db: DB, q: str | None = None, offset: int = 0) -> list[User]:
    query = select(User)
    if q:
        query = query.where(or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")))
    return list((await db.scalars(query.order_by(User.id.desc()).offset(offset).limit(50))).all())


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(user_id: int, body: AdminUserUpdate, actor: AdminUser, db: DB) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден.")
    if user.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя менять собственную роль или статус.")
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(user, key, value)
    db.add(AuditEvent(actor_id=actor.id, action="user_update", details={"user_id": user_id, **changes}))
    await db.commit()
    return user


@router.get("/users/{user_id}/ledger", response_model=list[LedgerOut])
async def user_ledger(user_id: int, _: AdminUser, db: DB) -> list[LedgerEntry]:
    return list((await db.scalars(
        select(LedgerEntry).where(LedgerEntry.user_id == user_id).order_by(LedgerEntry.id.desc()).limit(100)
    )).all())


@router.post("/users/{user_id}/balance")
async def adjust_balance(user_id: int, body: AdminBalanceIn, actor: AdminUser, db: DB) -> dict:
    if await db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден.")
    balance = await billing.apply(db, user_id, body.amount, "admin", body.comment, {"actor_id": actor.id})
    db.add(AuditEvent(actor_id=actor.id, action="balance_adjust",
                      details={"user_id": user_id, "amount": body.amount, "comment": body.comment}))
    await db.commit()
    return {"balance": balance}


@router.get("/models", response_model=list[AIModelAdmin])
async def models(_: AdminUser, db: DB) -> list[AIModel]:
    return list((await db.scalars(select(AIModel).order_by(AIModel.sort))).all())


@router.patch("/models/{model_id}", response_model=AIModelAdmin)
async def update_model(model_id: int, body: AIModelUpdate, actor: AdminUser, db: DB) -> AIModel:
    model = await db.get(AIModel, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Модель не найдена.")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("is_default"):
        await db.execute(update(AIModel).values(is_default=False))
    for key, value in changes.items():
        setattr(model, key, value)
    db.add(AuditEvent(actor_id=actor.id, action="model_update", details={"model_id": model_id, **changes}))
    await db.commit()
    await db.refresh(model)
    return model


@router.get("/payments")
async def payments(_: AdminUser, db: DB) -> list[dict]:
    rows = (await db.execute(
        select(Payment, User.email).join(User, User.id == Payment.user_id).order_by(Payment.id.desc()).limit(100)
    )).all()
    return [{"id": p.id, "email": email, "amount_kopeks": p.amount_kopeks, "tokens": p.tokens,
             "status": p.status, "provider": p.provider, "created_at": p.created_at} for p, email in rows]


BACKUP_DIR = Path("/backups")


@router.get("/backups")
def backups(_: AdminUser) -> dict:  # sync: file I/O runs in the threadpool
    """Status written by the backup service into the shared ./backups volume."""
    status_file = BACKUP_DIR / ".status.json"
    try:
        last = json.loads(status_file.read_text())
    except (OSError, ValueError):
        last = None
    files = sorted(BACKUP_DIR.glob("nova-*.dump"), reverse=True) if BACKUP_DIR.exists() else []
    last_ok = files[0].stat().st_mtime if files else None
    age_hours = (datetime.now(UTC).timestamp() - last_ok) / 3600 if last_ok else None
    return {
        "configured": BACKUP_DIR.exists(),
        "last": last,
        "healthy": age_hours is not None and age_hours < 26 and (last or {}).get("state") == "ok",
        "age_hours": round(age_hours, 1) if age_hours is not None else None,
        "count": len(files),
        "total_bytes": sum(f.stat().st_size for f in files),
        "files": [{"name": f.name, "size_bytes": f.stat().st_size,
                   "created_at": datetime.fromtimestamp(f.stat().st_mtime, UTC)} for f in files[:30]],
    }



@router.get("/mail")
async def mail_status(_: AdminUser) -> dict:
    return {"enabled": settings.mail_enabled, "host": settings.smtp_host, "port": settings.smtp_port,
            "user": settings.smtp_user, "support_email": settings.support_email, "last": mailer.last_result}


@router.post("/mail/test")
async def mail_test(actor: AdminUser) -> dict:
    """Sends a test letter synchronously so the admin sees the real SMTP error, if any."""
    if not settings.mail_enabled:
        return {"ok": False, "error": "SMTP не настроен: заполните SMTP_HOST, SMTP_USER, SMTP_PASSWORD в .env "
                                      "и выполните docker compose up -d"}
    ok = await mailer.send(settings.support_email, "Проверка почты Nova AI", "Почта работает ✦",
                           mailer.paragraph(f"Тестовое письмо отправлено из админки ({actor.email})."),
                           text="Тестовое письмо из админки Nova AI.")
    return {"ok": ok, "to": settings.support_email, "error": None if ok else mailer.last_result["error"]}
