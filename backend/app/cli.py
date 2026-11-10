"""Server-side admin tools.

    docker compose exec api python -m app.cli admin EMAIL [PASSWORD]
        Make EMAIL an administrator (creating the account if needed) and set its password.
        Without PASSWORD a random one is generated and printed.

    docker compose exec api python -m app.cli users COUNT [BALANCE]
        Create COUNT users with random emails and passwords, BALANCE sparks each
        (default WELCOME_TOKENS). Prints CSV: id,email,password,balance.
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


async def make_users(count: int, balance: int) -> None:
    domain = settings.public_url.split("//")[-1].split("/")[0].split(":")[0] or "nova.local"
    rows = []
    async with SessionLocal() as db:
        for _ in range(count):
            email = f"user-{secrets.token_hex(4)}@{domain}"
            password = secrets.token_urlsafe(9)
            user = User(email=email, name=email.split("@")[0], password_hash=hash_password(password),
                        ref_code=new_ref_code(), signup_source="generated")
            db.add(user)
            await db.flush()
            if balance:
                await billing.apply(db, user.id, balance, "welcome", "Стартовый баланс")
            rows.append((user.id, email, password, balance))
        await db.commit()
    print("id,email,password,balance")
    for row in rows:
        print(",".join(map(str, row)))


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "users" and sys.argv[2].isdigit():
        balance = int(sys.argv[3]) if len(sys.argv) > 3 else settings.welcome_tokens
        asyncio.run(make_users(min(int(sys.argv[2]), 10_000), balance))
        return
    if len(sys.argv) >= 3 and sys.argv[1] == "admin":
        asyncio.run(make_admin(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
