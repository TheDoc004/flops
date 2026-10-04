# Release Questline

_Opened 2026-10-04. Owner: Diego. Side questline. See [README](README.md)._

## Why this exists

FLOPS was built as a personal nutrition + training notebook, and it stays that way: **no
plans to make money from it.** Now that the app is mature, the goal is to get it in front of
people, for two reasons:

1. **Portfolio / resume:** anyone can find it, read the code, and run it.
2. **Accessibility:** a free, easy way for anyone to log food and training through the AI
   they already use.

The thinking behind it: as AI makes software easier to build, packaged off-the-shelf apps
matter less and open, remixable projects matter more. ChatGPT apps (OpenAI Dev Day) and Claude
connectors also remove FLOPS's old bottleneck, which was paying for AI. When FLOPS runs
inside the user's chat app, **the user's own plan pays for the model**, and FLOPS only stores
the results.

**The goal is to be good, not first.** Other nutrition MCPs exist. What sets FLOPS apart is
depth: the notebook philosophy (no nagging), confirm-first writes with `source=mcp` audit +
undo, measured-beats-estimated micros, and nutrition + gym in one store.

## The order: Quest A, then Quest B

The two quests don't compete. Both ChatGPT apps and Claude connectors speak **MCP**, so one
server serves both, and open-sourcing first makes the connector cheaper to run, because
power users self-host.

### Quest A: Open source

Make the repo a real open-source project people can read, fork, and self-host.

**Where it stands (2026-10-04):** `github.com/TheDoc004/flops` is already **public**, but it
has **no LICENSE**, which legally means "all rights reserved". Nobody may reuse it yet.

- [ ] **A1. Pick a license.** MIT (simplest, anyone can do anything) vs AGPL-3.0 (anyone
      who hosts a modified copy must publish their changes). Diego decides.
- [ ] **A2. Secrets / history audit.** Scan git history for keys, tokens, `.env`, `*.db`, and
      personal data (Diego's real logs, emails, photos in fixtures or `assets/`).
- [ ] **A3. Public README.** What FLOPS is, screenshots, the notebook philosophy, a
      feature list, the tech stack, and links to live + docs.
- [ ] **A4. One-command self-host.** Clear `.env.example`, `npm` setup from a fresh clone,
      maybe Docker. Test it on a clean machine/dir.
- [ ] **A5. "Connect your own FLOPS to Claude/ChatGPT" guide.** Builds on `docs/mcp-connector.md`.
- [ ] **A6. Contributor basics.** `CONTRIBUTING.md`, issue templates, CI running the test
      suites on PRs. Decide which internal docs (`HANDOFF.md`, agent docs) stay public.
- [ ] **A7. Resume polish.** Repo description/topics, a short architecture overview, and a
      pinned repo on the GitHub profile.

### Quest B: ChatGPT / Claude connector

Make connecting FLOPS to an AI app a one-click thing for a regular person, and eventually
get listed in the ChatGPT apps / Claude connector directories.

**Where it stands (2026-10-04):** the MCP server is live at `/mcp` with reads plus
confirm-first writes, audit, and undo (`docs/mcp-connector.md`). **But it is single-user:** one
static `MCP_API_TOKEN`, with writes scoped to `MCP_USER_ID`. That's the main gap.

- [ ] **B1. Per-user MCP auth.** Each FLOPS account connects as itself. Directories generally
      expect **OAuth 2.1** (with dynamic client registration). Build it on the existing Bearer
      session / email-OTP auth. This is the biggest piece of work.
- [ ] **B2. "Connect" page in the app** (probably under `/plan`). It shows the MCP URL, a copy
      button, and short per-client steps (Claude.ai, Claude Code, ChatGPT). The target is
      "paste URL → sign in → done".
- [ ] **B3. ChatGPT compatibility pass.** Test the same `/mcp` server in ChatGPT's apps /
      developer mode, and adjust tool descriptions or shapes if needed.
- [ ] **B4. Public-scale guardrails.** Per-user rate limits on MCP, data export + account
      deletion, and a privacy policy page (FLOPS would hold strangers' health data).
- [ ] **B5. Hosting reality check.** Render + SQLite on one disk is fine for a handful of
      users. Decide on a user cap / waitlist before listing publicly, and know the monthly cost.
- [ ] **B6. Directory submissions.** Submit to Claude's connector directory and the ChatGPT
      app directory, each with its own review requirements.

## Open decisions

- License: MIT or AGPL? (A1)
- Hosted FLOPS for strangers: how many users is Diego willing to host for free? (B5)
- Which internal docs stay in the public repo? (A6)

## Log

- **2026-10-04:** Questline opened. Direction agreed: do A, then B; one MCP server for both clients.
