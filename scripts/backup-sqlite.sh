#!/usr/bin/env bash
# Nightly-ish SQLite backup for FLOPS on Render (or any host with DB_PATH).
# Usage on Render Shell / cron:
#   DB_PATH=/var/data/nutrition.db BACKUP_DIR=/var/data/backups bash scripts/backup-sqlite.sh
# Then copy $BACKUP_DIR off-box (R2, scp, private GitHub release, etc.).

set -euo pipefail

DB_PATH="${DB_PATH:-./nutrition.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
  echo "No database at $DB_PATH — nothing to back up." >&2
  exit 1
fi

# Online-safe copy via sqlite3 if available; otherwise cp.
DEST="$BACKUP_DIR/nutrition-$STAMP.db"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  cp "$DB_PATH" "$DEST"
fi

# Keep last 14 backups locally on the disk.
ls -1t "$BACKUP_DIR"/nutrition-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f || true

echo "Wrote $DEST"
