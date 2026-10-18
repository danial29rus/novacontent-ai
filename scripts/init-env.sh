#!/bin/sh
# Creates .env from .env.example with fresh random secrets. Never overwrites an existing .env.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env уже существует — не трогаю. Удалите его вручную, если нужно пересоздать."; exit 1; fi
rand() { openssl rand -hex "$1"; }
DOMAIN=${DOMAIN:-24nova-ai.ru}
sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(rand 24)/" \
    -e "s/24nova-ai\.ru/$DOMAIN/g" \
    -e "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$(rand 12)/" \
    .env.example > .env
chmod 600 .env
echo "Создан .env. Пароль администратора:"
grep '^ADMIN_PASSWORD=' .env | cut -d= -f2
echo "Осталось вписать: OPENAI_API_KEY, SMTP_PASSWORD, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY."
