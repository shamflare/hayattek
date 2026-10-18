#!/usr/bin/env bash
# Restore into an EMPTY database (never over production without a decision).
#   TARGET_DATABASE_URL=... BACKUP_PASSPHRASE_FILE=... ./restore.sh /srv/backups/20261019T020000Z
set -euo pipefail
SRC=${1:?backup directory}
: "${TARGET_DATABASE_URL:?}" "${BACKUP_PASSPHRASE_FILE:?}"
(cd "$SRC" && sha256sum -c SHA256SUMS)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" \
  -in "$SRC/db.dump.enc" | pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_DATABASE_URL"
echo "database restored. Objects: decrypt objects.tar.enc the same way and 'aws s3 sync' it back."
echo "Then run: manage.py check_restore (row counts + ledger + audit integrity)."
