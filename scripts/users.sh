#!/bin/sh
# Generate test users. Usage: ./scripts/users.sh COUNT [BALANCE]
# Saves logins and passwords to backups/users-<date>.csv and prints them.
set -eu
cd "$(dirname "$0")/.."
[ "$#" -ge 1 ] || { echo "Usage: ./scripts/users.sh COUNT [BALANCE]"; exit 1; }
mkdir -p backups
OUT="backups/users-$(date +%Y%m%d-%H%M%S).csv"
docker compose exec -T api python -m app.cli users "$1" ${2:+"$2"} > "$OUT"
chmod 600 "$OUT"
cat "$OUT"
echo "Сохранено: $OUT"
