#!/bin/sh
# Restores a dump into a throwaway database and compares row counts with the live one.
# Usage: ./scripts/verify-backup.sh [backups/nova-….dump]   (default: newest)
set -eu
cd "$(dirname "$0")/.."
FILE=${1:-$(ls -1t backups/nova-*.dump 2>/dev/null | head -1)}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Нет дампов в backups/"; exit 1; }
echo "Проверяю $FILE"
psql() { docker compose exec -T db psql -U nova -v ON_ERROR_STOP=1 -qtA "$@"; }
psql -d postgres -c "DROP DATABASE IF EXISTS nova_verify" -c "CREATE DATABASE nova_verify"
docker compose exec -T db pg_restore --no-owner -U nova -d nova_verify < "$FILE"
fail=0
for table in users ledger_entries payments chats messages generations agents projects knowledge_bases chunks promo_codes; do
  restored=$(psql -d nova_verify -c "SELECT count(*) FROM $table")
  live=$(psql -d nova -c "SELECT count(*) FROM $table")
  mark="ok"; [ "$restored" -le "$live" ] || { mark="FAIL"; fail=1; }
  printf '  %-4s %-16s в дампе %-6s сейчас %s\n' "$mark" "$table" "$restored" "$live"
done
version=$(psql -d nova_verify -c "SELECT version_num FROM alembic_version")
echo "  схема в дампе: $version"
psql -d postgres -c "DROP DATABASE nova_verify"
[ "$fail" -eq 0 ] && echo "Дамп восстанавливается корректно." || { echo "Дамп содержит больше строк, чем живая база — проверьте вручную."; exit 1; }
