# Tools for backup.sh / restore.sh, so the host needs nothing but Docker.
FROM postgres:16-alpine
RUN apk add --no-cache bash openssl aws-cli coreutils
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["backup.sh"]
