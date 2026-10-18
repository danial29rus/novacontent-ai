#!/bin/sh
# Nova Postgres backups.
#   nova-backup daemon   daily at BACKUP_TIME (default), plus one on start if the last is older than a day
#   nova-backup once     a single backup right now
# Each dump is verified with pg_restore --list before it counts; optional copy to S3 (Timeweb Cloud Storage).
set -u

DIR=/backups
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
AT=${BACKUP_TIME:-04:00}
export PGHOST=${PGHOST:-db} PGUSER=${PGUSER:-nova} PGDATABASE=${PGDATABASE:-nova}

log() { echo "$(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

status() {  # status ok|error file size s3 message
  printf '{"state":"%s","at":"%s","file":"%s","size_bytes":%s,"s3":"%s","message":"%s"}\n' \
    "$1" "$(date -Iseconds)" "$2" "${3:-0}" "$4" "$5" > "$DIR/.status.json.tmp" && mv "$DIR/.status.json.tmp" "$DIR/.status.json"
}

upload() {
  [ -n "${S3_BUCKET:-}" ] || { echo "off"; return 0; }
  if aws --endpoint-url "${S3_ENDPOINT:-https://s3.twcstorage.ru}" s3 cp --only-show-errors \
       "$1" "s3://$S3_BUCKET/${S3_PREFIX:-nova}/$(basename "$1")" >&2; then
    echo "ok"
  else
    echo "failed"
  fi
}

prune() {
  find "$DIR" -maxdepth 1 -name 'nova-*.dump' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/pruned /'
  [ -n "${S3_BUCKET:-}" ] || return 0
  cutoff=$(date -d "@$(( $(date +%s) - KEEP_DAYS * 86400 ))" +%Y%m%d)
  aws --endpoint-url "${S3_ENDPOINT:-https://s3.twcstorage.ru}" s3 ls "s3://$S3_BUCKET/${S3_PREFIX:-nova}/" 2>/dev/null |
    awk '{print $4}' | while read -r name; do
      day=$(echo "$name" | sed -n 's/^nova-\([0-9]\{8\}\)-.*/\1/p')
      [ -n "$day" ] && [ "$day" -lt "$cutoff" ] &&
        aws --endpoint-url "${S3_ENDPOINT:-https://s3.twcstorage.ru}" s3 rm --only-show-errors \
          "s3://$S3_BUCKET/${S3_PREFIX:-nova}/$name" && echo "pruned s3 $name"
    done
}

backup() {
  stamp=$(date +%Y%m%d-%H%M%S)
  file="$DIR/nova-$stamp.dump"
  tmp="$file.partial"
  log "backup started"
  if ! pg_dump -Fc -Z 6 -f "$tmp"; then
    rm -f "$tmp"; status error "" 0 off "pg_dump failed"; log "ERROR pg_dump failed"; return 1
  fi
  # A dump only counts if it can be read back.
  if ! pg_restore --list "$tmp" > /dev/null; then
    rm -f "$tmp"; status error "" 0 off "dump is unreadable"; log "ERROR dump verification failed"; return 1
  fi
  mv "$tmp" "$file"
  size=$(stat -c %s "$file")
  s3=$(upload "$file")
  touch "$DIR/.last_success"
  status ok "$(basename "$file")" "$size" "$s3" ""
  log "backup ok: $(basename "$file") ($size bytes), s3=$s3"
  prune
}

seconds_until() {  # next occurrence of HH:MM in local time
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $1" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

mkdir -p "$DIR"
case "${1:-daemon}" in
  once) backup ;;
  daemon)
    log "backup daemon: daily at $AT ($TZ), keep $KEEP_DAYS days, s3=${S3_BUCKET:-off}"
    if [ -z "$(find "$DIR/.last_success" -mmin -1440 2>/dev/null)" ]; then backup || true; fi
    while :; do
      wait=$(seconds_until "$AT")
      log "next backup in $((wait / 3600))h $((wait % 3600 / 60))m"
      sleep "$wait"
      backup || true
    done ;;
  *) echo "usage: nova-backup [daemon|once]"; exit 2 ;;
esac
