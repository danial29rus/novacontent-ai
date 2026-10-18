#!/bin/sh
# Backup right now (the backup service also runs daily on its own).
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T backup nova-backup once
