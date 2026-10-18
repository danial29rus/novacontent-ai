#!/bin/sh
# Upload the project to the server and (re)start it.
# Usage: ./scripts/deploy.sh root@SERVER_IP [/opt/nova]
set -eu
cd "$(dirname "$0")/.."
TARGET=${1:?"Usage: ./scripts/deploy.sh root@SERVER_IP [/opt/nova]"}
DIR=${2:-/opt/nova}
rsync -az --delete \
  --exclude .env --exclude backups --exclude legacy --exclude '.git' \
  --exclude node_modules --exclude 'frontend/dist' --exclude '.venv' --exclude '__pycache__' \
  --exclude '.pytest_cache' --exclude '.ruff_cache' --exclude '*.tsbuildinfo' \
  ./ "$TARGET:$DIR/"
ssh "$TARGET" "cd $DIR && test -f .env || { echo 'Нет .env на сервере: выполните ./scripts/init-env.sh'; exit 1; } \
  && ./scripts/backup.sh 2>/dev/null || true; docker compose up -d --build && docker compose ps"
