"""Server-side admin tools.

    docker compose exec api python -m app.cli admin EMAIL [PASSWORD]
        Make EMAIL an administrator (creating the account if needed) and set its password.
        Without PASSWORD a random one is generated and printed.
"""

import asyncio
import secrets
import sys

from sqlalchemy import delete, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Session, User
from app.services import billing
from app.services.growth import new_ref_code


async def make_admin(email: str, password: str | None) -> None:
    email = email.strip().lower()
    password = password or secrets.token_urlsafe(12)
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        created = user is None
        if created:
            user = User(email=email, name="Администратор", password_hash="", ref_code=new_ref_code())
            db.add(user)
            await db.flush()
            await billing.apply(db, user.id, settings.welcome_tokens, "welcome", "Стартовый баланс")
        user.role, user.status, user.password_hash = "admin", "active", hash_password(password)
        await db.execute(delete(Session).where(Session.user_id == user.id))  # old logins stop working
        await db.commit()
    print(f"{'Создан' if created else 'Обновлён'} администратор: {email}")
    print(f"Пароль: {password}")
    print(f"Вход: {settings.public_url}/login  →  меню «Админка»")


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "admin":
        asyncio.run(make_admin(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
