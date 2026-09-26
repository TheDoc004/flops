# Deployment + MCP Connector — Plan

_Written 2026-08-02. **Updated 2026-09-26:** deploy + auth live; MCP is **direct writes**
(no propose/commit). Full user-scoped read/write parity + guarded `query` — see
`docs/mcp-connector.md`._

## Status (2026-09)

| Step | Status |
|---|---|
| 1 Auth + rate limiting | **Done** (Bearer sessions, not shared-secret) |
| 2 Render + Vercel deploy | **Done** (`useflops.com` + `flops-c6ic.onrender.com`) |
| 3 MCP server | **Done** — reads + direct domain writes + `query` at `/mcp` |

---

## The original goal, in one sentence

Log meals into FLOPS from the Claude app on the phone, so the copy-paste step through the
AI Logger disappears.

**Current shape (Sept 2026):** MCP writes **commit immediately** (audited, `source=mcp`,
meal soft-delete + `revert_mcp_write`). There is **no** propose/commit handshake anymore.
Agents can also mutate recipes, supplements, goals, profile, weights, and gym data for the
bound `MCP_USER_ID` only.

## Why this shape

Diego's actual workflow: batch-cooks (e.g. 1.5 kg chicken), tells Claude the uncooked
weight so it knows the macros for the whole batch, then per meal gives cooked weights —
"90 g uncooked rice, 200 g tomatoes, 150 g chicken" — and Claude returns the macros.
Today he copies that into the FLOPS AI Logger by hand. He is the middleman, and that is
the thing being removed.

Notably **Claude does all the macro maths in the chat**. FLOPS only has to accept final
numbers for many paths — or resolve library ingredients by id.

## Decision made

**Deploy to Render with a persistent disk (~$7/mo), always on.** Diego chose this over the
free Cloudflare Tunnel alternative because a tunnel only works while the Mac is awake.
The deploy is required anyway: custom connectors are reached from Anthropic's cloud, not
the phone, so the server must be publicly resolvable.

---

## Findings from the 2026-08-02 audit

### The hard part is already built

`POST /api/log/custom` already accepts exactly what Claude produces. MCP `log_meal` /
`add_food_item` cover the same ground with library-id and per-100g paths.

### Codebase health — good

- SQL is parameterized; MCP `query` is SELECT/WITH-only with user-scoped TEMP VIEWs.
- Migrations are idempotent and run on boot.
- Multi-user: HTTP uses `req.user.id`; MCP uses `MCP_USER_ID`.

### Risks that only exist once public

1. **AI endpoints spend real money.** Rate limits + `ai_usage` caps protect paid routes.
2. **MCP token is powerful** for one user — treat `MCP_API_TOKEN` like a password; rotate if leaked.
3. Optional later: IP allowlist for Anthropic egress `160.79.104.0/21`.

For the live tool catalog and auth setup, always prefer **`docs/mcp-connector.md`**.

   **This is the most expensive failure mode.**
2. **No backups.** 609 log entries and 284 recipes in one SQLite file, no export in the app,
   no backup script. On the Mac it is covered by Time Machine/iCloud; on a Render disk that
   safety net is gone. A bad migration or disk failure loses months of data. **This is the
   most likely failure mode.**
3. **No Node version pin.** No `engines` field in either `package.json`. `server/index.js`
   uses `process.loadEnvFile`, which needs Node ≥ 20.12. Render picks its own default.

Minor: the stale empty `nutrition.db` at the repo root shadows the real DB if `DB_PATH` is
unset — delete it. One low-severity `body-parser` advisory; `npm audit fix` clears it.

### Claude connector facts (researched 2026-08-02, so they need not be re-derived)

- Custom connectors work on **Claude mobile**, web, Desktop, and Cowork; Free through Enterprise.
- Transport must be **Streamable HTTP** (legacy HTTP+SSE is deprecated).
- Auth options, easiest first:
  - `static_headers` — a fixed API key/bearer token entered once when adding the connector.
    **In beta.** Try this first.
  - `none` — authless, explicitly supported. Acceptable only combined with the IP allowlist
    below, and even then it is security-by-obscurity.
  - `oauth_dcr` / `oauth_cimd` — full OAuth with Dynamic Client Registration. Supported out
    of the box but a multi-day build. Avoid unless forced.
  - Tokens in the URL query string are explicitly **not** supported/recommended.
- **Anthropic's outbound egress is `160.79.104.0/21`.** Firewall the `/mcp` route to that
  range — this does most of the security work even without OAuth.
- Limits: 300 s timeout, ~150,000 character max tool result.
- OAuth callback (if ever needed): `https://claude.ai/api/mcp/auth_callback`.
- There is an official `mcp-server-dev` plugin for Claude Code that scaffolds and tests MCP
  servers interactively.

---

## The sequence

Each step has a usable milestone, so stopping between them is safe.

### Step 1 — Auth + rate limiting (~1 hour)

Prerequisite for everything else; nothing goes public before this lands.

- Shared-secret middleware over `/api/*`, secret from an env var; client sends it too.
- Rate limit, tight on `/api/ai/*` — this is the money guard, not a nicety.
- Add `engines` (Node ≥ 20.12, ideally pin to what Render runs) to both `package.json`s.
- Delete the stale root `nutrition.db`.
- `npm audit fix` for the `body-parser` advisory.

**Note:** this reverses the long-standing "Do not add auth" convention in `CLAUDE.md`.
That was correct for a localhost-only app; it is not correct once the API is public.
Update `CLAUDE.md` in the same pass.

### Step 2 — Deploy to Render + Vercel (~half a day incl. debugging)

Config was worked out during the 2026-06 deploy prep and still holds:

- **Backend → Render Web Service.** Root `server`, build `npm install`, start `npm start`
  (**not** `npm run dev` — `node --watch` restart-loops on SQLite writes), health check
  `/health` (already implemented). Persistent disk mounted at `/var/data`.
- **Frontend → Vercel.** Root `client`, Vite preset, output `dist`. Add
  `client/vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`
  or SPA deep links 404.
- **Order matters:** backend → set `VITE_API_BASE_URL` on Vercel → deploy frontend → set
  `ALLOWED_ORIGIN` on Render (exact origin, no trailing slash) → redeploy.
- **Env vars:** `DB_PATH=/var/data/nutrition.db` set **explicitly** (see the shadowing
  footgun above), `NODE_VERSION=20`, `ALLOWED_ORIGIN`, plus `OPENAI_API_KEY` /
  `ANTHROPIC_API_KEY`. `PORT` is automatic. `VITE_API_BASE_URL` is **build-time** — changing
  it requires a rebuild, not just a redeploy.
- Upload the existing 584 KB `server/nutrition.db` to the disk — it is gitignored, so the
  deployed DB starts **empty** otherwise. Migrations run on boot.
- **Backups before calling this done** — nightly copy of the SQLite file off Render.
  Cheapest sound option: Cloudflare R2 (free tier is ample for a 584 KB file) or a private
  GitHub repo.

Milestone: FLOPS works from the phone's browser.

### Step 3 — MCP server (~half a day)

**Done (2026-09):** `/mcp` Streamable HTTP on the Express API.

**Reads:** `get_day`, `get_log_range`, `get_goals`, `get_body_weights`, `get_intake_weight_trend`,
`get_profile`, `get_supplements_range`, `get_micronutrient_totals`, `search_recipes`,
`get_gym_today`, `get_gym_progress`, `list_recent_mcp_writes`.

**Writes (propose → chat confirm → commit):** `propose_meal_entry`, `propose_food_item`,
`propose_supplement_correction`, `commit_proposal`, `list_proposals`, `discard_proposal`.
Rows permanently flagged `source`/`created_via` = `mcp`; audit table; UI badge + bulk undo.

Auth via `MCP_API_TOKEN` (Bearer or `x-api-key`). Setup: `docs/mcp-connector.md`.

**Still open:**

- Optional: firewall `/mcp` to Anthropic egress `160.79.104.0/21`.
- Per-user MCP tokens when multi-user traffic arrives.

Milestone: "log this" on the phone → Claude shows macros + code → you approve in chat → it appears in FLOPS with an MCP badge.

---

## What Diego needs to provide

1. Render account (pick a region near him).
2. Vercel account — or a decision to serve the built client from Render instead (one
   service, one bill, slightly slower).
3. AI API keys entered into Render's env vars directly. **The AI Logger stops working in
   production until they are there.** He enters them; they are never pasted into chat.
4. A decision on where backups go (R2 vs private GitHub repo).
5. Whether he wants a custom domain or `*.onrender.com` is fine.

The API secret will be generated for him to paste into Render — he does not need to invent one.

## Honest caveat

This moves macro estimation from the AI Logger into the Claude app. It does **not** make the
estimate more accurate on its own — same class of model guessing the same grams of chicken.
What it buys is that the estimate already happens there, in a conversation that has context
about the batch cook, instead of being retyped into a second tool.
