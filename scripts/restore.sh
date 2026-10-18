#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
[ "$#" -eq 1 ] || { echo "Usage: ./scripts/restore.sh backups/file.dump"; exit 1; }
[ -f "$1" ] || { echo "File not found: $1"; exit 1; }
printf "Восстановить базу из %s? Текущие данные будут заменены. [y/N] " "$1"; read -r answer
[ "$answer" = "y" ] || exit 1
docker compose exec -T db pg_restore --clean --if-exists --no-owner -U nova -d nova < "$1"
echo "Restored $1"
