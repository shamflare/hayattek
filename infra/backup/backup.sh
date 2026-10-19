#!/usr/bin/env bash
# HayatTek backup: PostgreSQL (custom format) + private object storage, encrypted at rest.
# Usage (production host, cron daily):
#   DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/run/secrets/backup_pass S3_ENDPOINT_URL=... \
#   S3_BUCKET=hayat-private BACKUP_DIR=/srv/backups ./backup.sh
# Copy BACKUP_DIR off-site (different provider/region). Never store the passphrase with the backups.
set -euo pipefail
: "${DATABASE_URL:?}" "${BACKUP_PASSPHRASE_FILE:?}" "${BACKUP_DIR:?}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"
umask 077

# 1) Database: consistent snapshot, compressed, then encrypted (AES-256, PBKDF2).
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" \
  > "$OUT/db.dump.enc"

# 2) Documents & audio objects (already private; audio is additionally Fernet-encrypted by the app).
if [[ -n "${S3_BUCKET:-}" ]]; then
  # Reuse the app's S3 credentials (prod.env) when no AWS_* variables are given.
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${S3_ACCESS_KEY:-}}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${S3_SECRET_KEY:-}}"
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${S3_REGION:-us-east-1}}"
  aws s3 sync "s3://$S3_BUCKET" "$OUT/objects" ${S3_ENDPOINT_URL:+--endpoint-url "$S3_ENDPOINT_URL"} --only-show-errors
  tar -C "$OUT" -cf - objects | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -pass "file:$BACKUP_PASSPHRASE_FILE" > "$OUT/objects.tar.enc"
  rm -rf "$OUT/objects"
fi

sha256sum "$OUT"/*.enc > "$OUT/SHA256SUMS"
# Retention: keep 35 daily backups locally.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +35 -exec rm -rf {} +
echo "backup ok: $OUT"
