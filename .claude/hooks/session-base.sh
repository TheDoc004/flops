#!/usr/bin/env bash
# SessionStart: record the commit this session started from, so the Stop hook
# can tell what changed even after the work has been committed and pushed.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT="$(cat)"
SID="$(printf '%s' "$INPUT" | jq -r '.session_id // "nosession"')"
BASE_DIR="${TMPDIR:-/tmp}/flops-handoff"

mkdir -p "$BASE_DIR"
git -C "$REPO" rev-parse HEAD > "$BASE_DIR/$SID" 2>/dev/null || true
exit 0
