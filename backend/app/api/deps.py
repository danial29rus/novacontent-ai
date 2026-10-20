from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.security import new_token, token_hash
from app.db.session import get_db
from app.models import Session, User

COOKIE = "nova_session"
RATE_LIMIT_COOKIE = "nova_rate_limit"

DB = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: DB) -> User:
    token = request.cookies.get(COOKIE)
    if token:
        user = await db.scalar(
            select(User).join(Session, Session.user_id == User.id)
            .where(Session.token_hash == token_hash(token), Session.expires_at > datetime.now(UTC))
        )
        if user and user.status == "active":
            return user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужно войти в аккаунт.")


async def admin_user(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только для администраторов.")
    return user


async def rate_limited(request: Request, response: Response) -> None:
    """Limit by an account session or a random browser token, never by IP address."""
    identity = request.cookies.get(COOKIE) or request.cookies.get(RATE_LIMIT_COOKIE)
    if not identity:
        identity = new_token()
        response.set_cookie(RATE_LIMIT_COOKIE, identity, max_age=86_400, httponly=True,
                            secure=settings.cookie_secure, samesite="lax", path="/")
    if not await ratelimit.allow(identity):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много запросов. Подождите минуту.")


CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(admin_user)]
RateLimited = Depends(rate_limited)


async def owned[T](db: AsyncSession, model: type[T], obj_id: int | None, user: User) -> T:
    """Fetch a row the user owns, or 404. Never reveals whether someone else's row exists."""
    obj = await db.get(model, obj_id) if obj_id is not None else None
    if obj is None or getattr(obj, "user_id", None) != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Не найдено.")
    return obj
