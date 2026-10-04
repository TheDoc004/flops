# Questlines

_Started 2026-10-04._

FLOPS work is split into **questlines**: long-running tracks with their own goals, so one
kind of work doesn't get buried under another. When Diego says "let's work on the release
questline" (or "open source", "connector", "quest A/B"), open the matching file below.

| Questline | What it is | File |
|---|---|---|
| **Build** (main) | Features, UI polish, bug fixes: making the app itself good. | `HANDOFF.md` + `CLAUDE.md` (already tracked there) |
| **Release** (side) | Getting FLOPS out to the public: open source, then ChatGPT / Claude connector. **Not** feature work. | [`release.md`](release.md) |

## Rules

- **Keep questlines separate.** A Release session doesn't add app features, and a Build
  session doesn't do release chores. If one needs the other (e.g. the connector needs
  OAuth in the server), log it as a quest step here and do it as its own piece of work.
- **Each questline file is the source of truth for its progress.** Tick the checkboxes and
  add a dated line to its log when a step lands. `HANDOFF.md` gets a one-line pointer, not the details.
- **New questlines** get a row in the table above and their own file.
