from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from app.api.deps import COOKIE, DB, CurrentUser, RateLimited
from app.core.config import settings
from app.core.security import hash_password, new_token, token_hash, verify_password
from app.models import PasswordReset, Session, SupportTicket, User
from app.schemas import ForgotIn, LoginIn, PasswordIn, ProfileIn, RegisterIn, RegisterOut, ResetIn, SupportIn, UserOut
from app.services import billing, growth, mailer

router = APIRouter(tags=["auth"])


async def _start_session(db: DB, user: User, request: Request, response: Response) -> None:
    token = new_token()
    now = datetime.now(UTC)
    await db.execute(delete(Session).where(Session.expires_at < now))
    db.add(Session(user_id=user.id, token_hash=token_hash(token),
                   expires_at=now + timedelta(days=settings.session_days),
                   user_agent=(request.headers.get("user-agent") or "")[:300]))
    user.last_seen_at = now
    await db.commit()
    response.set_cookie(COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
                        secure=settings.cookie_secure, samesite="lax", path="/")


@router.post("/auth/register", response_model=RegisterOut, status_code=201, dependencies=[RateLimited])
async def register(body: RegisterIn, request: Request, response: Response, db: DB) -> RegisterOut:
    email = body.email.lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот email уже зарегистрирован.")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    await billing.apply(db, user.id, settings.welcome_tokens, "welcome", "Приветственный баланс")
    notices = await growth.on_signup(db, user, ref=body.ref, promo=body.promo,
                                     utm_source=body.utm_source, utm_campaign=body.utm_campaign)
    await _start_session(db, user, request, response)
    await db.refresh(user)
    return RegisterOut(**UserOut.model_validate(user).model_dump(), notices=notices)


@router.post("/auth/login", response_model=UserOut, dependencies=[RateLimited])
async def login(body: LoginIn, request: Request, response: Response, db: DB) -> User:
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash) or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль.")
    await _start_session(db, user, request, response)
    return user


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, db: DB) -> None:
    if token := request.cookies.get(COOKIE):
        await db.execute(delete(Session).where(Session.token_hash == token_hash(token)))
        await db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfileIn, user: CurrentUser, db: DB) -> User:
    user.name = body.name.strip()
    await db.commit()
    return user


@router.post("/me/password", status_code=204)
async def change_password(body: PasswordIn, user: CurrentUser, request: Request, db: DB) -> None:
    if not verify_password(body.current, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль неверный.")
    user.password_hash = hash_password(body.new)
    # Sign out every other device.
    current = token_hash(request.cookies.get(COOKIE, ""))
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.token_hash != current))
    await db.commit()


@router.post("/support", status_code=201, dependencies=[RateLimited])
async def support(body: SupportIn, user: CurrentUser, db: DB) -> dict:
    ticket = SupportTicket(user_id=user.id, subject=body.subject, message=body.message)
    db.add(ticket)
    await db.commit()
    # To the support inbox; "Reply" in the mail client goes straight to the user.
    await mailer.send(
        settings.support_email, f"[Nova #{ticket.id}] {body.subject}", f"Обращение #{ticket.id}",
        mailer.paragraph(f"От: {user.name} <{user.email}>\n\n{body.message}"),
        text=f"От: {user.name} <{user.email}>\n\n{body.message}", reply_to=user.email,
    )
    await mailer.send(
        user.email, f"Мы получили ваше обращение #{ticket.id}", "Обращение получено",
        mailer.paragraph(f"Спасибо! Мы ответим на {user.email} в течение рабочего дня.\n\nТема: {body.subject}"),
        text=f"Мы получили ваше обращение #{ticket.id} и ответим в течение рабочего дня.",
    )
    return {"ok": True, "id": ticket.id}


@router.get("/public/config")
async def public_config() -> dict:
    return {"support_email": settings.support_email, "public_url": settings.public_url,
            "payments_enabled": billing.payments_enabled(), "mail_enabled": settings.mail_enabled}


RESET_TTL = timedelta(hours=1)


@router.post("/auth/forgot", status_code=202, dependencies=[RateLimited])
async def forgot_password(body: ForgotIn, db: DB) -> dict:
    """Always 202, so the endpoint can't be used to probe which emails are registered."""
    user = await db.scalar(select(User).where(User.email == body.email.lower(), User.status == "active"))
    if user:
        token = new_token()
        db.add(PasswordReset(user_id=user.id, token_hash=token_hash(token), expires_at=datetime.now(UTC) + RESET_TTL))
        await db.commit()
        link = f"{settings.public_url}/reset-password?token={token}"
        await mailer.send(
            user.email, "Восстановление пароля Nova AI", "Восстановление пароля",
            mailer.paragraph("Вы запросили смену пароля. Ссылка действует 1 час.\n\n"
                             "Если это были не вы — просто проигнорируйте письмо."),
            text=f"Ссылка для смены пароля (действует 1 час): {link}", button=("Задать новый пароль", link),
        )
    return {"ok": True, "mail_enabled": settings.mail_enabled}


@router.post("/auth/reset", status_code=204, dependencies=[RateLimited])
async def reset_password(body: ResetIn, db: DB) -> None:
    reset = await db.scalar(select(PasswordReset).where(
        PasswordReset.token_hash == token_hash(body.token), PasswordReset.used_at.is_(None),
        PasswordReset.expires_at > datetime.now(UTC)))
    user = await db.get(User, reset.user_id) if reset else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ссылка устарела или уже использована. Запросите новую.")
    user.password_hash = hash_password(body.password)
    reset.used_at = datetime.now(UTC)
    await db.execute(delete(Session).where(Session.user_id == user.id))  # sign out everywhere
    await db.commit()
