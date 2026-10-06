#!/usr/bin/env bash
# Stop: if this session changed source files but left HANDOFF.md alone, block
# once and say so. Fires at most once per turn — when Claude continues after a
# block, stop_hook_active is set and this exits clean, so it reminds rather
# than traps.
set -uo pipefail

# Docs that must move when source moves. Add to this list as needed.
TRACKED_DOCS=("HANDOFF.md")

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT="$(cat)"

# Already blocked once this turn — let the stop through.
[[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" == "true" ]] && exit 0

SID="$(printf '%s' "$INPUT" | jq -r '.session_id // "nosession"')"
BASE_FILE="${TMPDIR:-/tmp}/flops-handoff/$SID"
BASE="$(cat "$BASE_FILE" 2>/dev/null || true)"
[[ -z "$BASE" ]] && BASE="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
[[ -z "$BASE" ]] && exit 0   # not a git repo; nothing to compare

# Everything touched since the session began: committed since BASE, plus
# whatever is still sitting in the working tree (staged, unstaged, untracked).
CHANGED="$(
  { git -C "$REPO" diff --name-only "$BASE" HEAD 2>/dev/null
    git -C "$REPO" status --porcelain 2>/dev/null | sed 's/^...//' | sed 's/.* -> //'
  } | sed '/^$/d' | sort -u
)"
[[ -z "$CHANGED" ]] && exit 0

# Source = anything that isn't documentation, tooling config, build output, or
# loose assets (assets/ holds images/media, not app code).
SOURCE="$(printf '%s\n' "$CHANGED" | grep -vE '(\.md$|^\.claude/|^docs/|^assets/|/dist/|^client/dist/|node_modules/|package-lock\.json$)' || true)"
[[ -z "$SOURCE" ]] && exit 0

# Did any tracked doc move too?
for doc in "${TRACKED_DOCS[@]}"; do
  printf '%s\n' "$CHANGED" | grep -qxF "$doc" && exit 0
done

COUNT="$(printf '%s\n' "$SOURCE" | wc -l | tr -d ' ')"
SAMPLE="$(printf '%s\n' "$SOURCE" | head -8 | sed 's/^/  - /')"

cat >&2 <<MSG
This session changed $COUNT source file(s) but did not touch ${TRACKED_DOCS[0]}:

$SAMPLE

${TRACKED_DOCS[0]} says it is updated each session, and it is what the next
session reads first. Before finishing, either:
  1. Update ${TRACKED_DOCS[0]} to reflect what changed (bump "Last updated",
     and revise the section this work affects), or
  2. Tell the user plainly why this change does not warrant a HANDOFF entry.

Do not silently skip it.
MSG
exit 2
