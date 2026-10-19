#!/bin/sh
# Reset/create an administrator. Usage: ./scripts/admin.sh [email] [password]
# Defaults to ADMIN_EMAIL from .env; without a password a new random one is printed.
set -eu
cd "$(dirname "$0")/.."
EMAIL=${1:-$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2)}
docker compose exec -T api python -m app.cli admin "$EMAIL" ${2:+"$2"}
