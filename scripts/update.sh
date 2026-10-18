#!/bin/sh
# Pull the latest code and redeploy with a backup first. Run on the server from /opt/nova.
set -eu
cd "$(dirname "$0")/.."
echo "▸ Бэкап перед обновлением"; docker compose exec -T backup nova-backup once || echo "(бэкап пропущен)"
echo "▸ git pull";                  git pull --ff-only
echo "▸ Пересборка";                docker compose up -d --build --remove-orphans
for _ in $(seq 1 60); do
  case "$(docker compose ps --format '{{.Health}}' api web)" in *starting*) sleep 3 ;; *) break ;; esac
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
docker image prune -f >/dev/null
DOMAIN=$(grep '^PUBLIC_URL=' .env | cut -d= -f2)
./scripts/smoke.sh "$DOMAIN"
