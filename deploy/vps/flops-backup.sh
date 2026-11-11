#!/bin/bash
# /usr/local/bin/flops-backup — consistent online SQLite snapshot (safe while the app writes).
set -euo pipefail
DB=/var/lib/flops/nutrition.db
DEST=/var/lib/flops/backups
KEEP=14
umask 027
[ -f "$DB" ] || { echo "no database at $DB" >&2; exit 1; }
OUT="$DEST/flops-$(date +%F_%H%M).db"
sqlite3 "$DB" ".backup '$OUT.part'"
sqlite3 "$OUT.part" "PRAGMA integrity_check;" | grep -qx ok
mv "$OUT.part" "$OUT"
gzip -f "$OUT"
ls -1t "$DEST"/flops-*.db.gz | tail -n +$((KEEP+1)) | xargs -r rm -f
echo "backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
