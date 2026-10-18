# Must match the server's major version (pgvector/pgvector:pg16).
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli tzdata
COPY nova-backup.sh /usr/local/bin/nova-backup
RUN chmod +x /usr/local/bin/nova-backup
ENTRYPOINT ["nova-backup"]
CMD ["daemon"]
HEALTHCHECK --interval=5m --timeout=10s --start-period=10m \
  CMD find /backups/.last_success -mmin -1560 | grep -q . || exit 1
