# FLOPS MCP connector

Model Context Protocol endpoint so Claude (or another agent) can analyze FLOPS data
and — with in-chat confirmation — write meals, foods, and supplement dose fixes.

**URL:** `https://flops-c6ic.onrender.com/mcp`  
**Auth (either):** `Authorization: Bearer <MCP_API_TOKEN>` **or** `x-api-key: <MCP_API_TOKEN>`  
**Transport:** Streamable HTTP (stateless)

**Claude.ai:** Choose **No sign-in**, then add Request header `x-api-key` = your token (no `Bearer` prefix). Do **not** use OAuth Client ID. Avoid `Authorization` in Request headers — Claude may incorrectly start OAuth. If you only see a failing **Connect** button, remove the connector and re-add with No sign-in + `x-api-key`.

---

## 1. Render env vars

On the API web service (`flops-c6ic`), set:

| Variable | Required | Notes |
|---|---|---|
| `MCP_API_TOKEN` | Yes | Long random secret (e.g. `openssl rand -hex 32`) |
| `MCP_USER_ID` | No | FLOPS `users.id` to read/write. Defaults to the first user (owner). |

Redeploy after saving. Until `MCP_API_TOKEN` is set, `/mcp` returns **503**.

**Auth note:** static token only (Bearer or `x-api-key`). No OAuth. Writes are scoped to `MCP_USER_ID` (or the first user).

---

## 2. Add the connector in Claude

1. Claude → **Customize** → **Connectors** → **Add custom connector**.
2. Name: anything (e.g. Flops). URL: `https://flops-c6ic.onrender.com/mcp`.
3. Authentication: **No sign-in** (not “Sign in now”).
4. **Request headers** → add:
   - Header name: `x-api-key`
   - Header value: `<your MCP_API_TOKEN>` (raw secret — **no** `Bearer ` prefix)
5. Leave **OAuth Client ID / Secret** empty.
6. Save / Add. Enable in a chat via **+** → Connectors.

If Flops already exists and **Connect** fails with “Couldn't register with … sign-in service”, **remove** it and re-add with the steps above. That Connect path is OAuth; FLOPS does not speak OAuth.

**Claude Code** (Bearer works reliably):

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer $MCP_API_TOKEN" \
  flops https://flops-c6ic.onrender.com/mcp
```

Optional hardening later: restrict `/mcp` to Anthropic egress `160.79.104.0/21` (see `docs/future/deployment-and-mcp.md`).

---

## 3. Read tools

| Tool | Use |
|---|---|
| `get_day` | One day: meals, totals, supplements, goals, vs-range, weight |
| `get_log_range` | Daily summaries (optional full entries); max 90 days |
| `get_goals` | Weekly min/max macros for a date |
| `get_body_weights` | Weight history |
| `get_intake_weight_trend` | Intake averages + OLS weight slope/SE + inferred maintenance (max 90 days; optional `split_at`) |
| `get_profile` | Profile / units |
| `get_supplements_range` | Taken supplements with dose-scaled macros/micros |
| `get_micronutrient_totals` | Summed micros over a range |
| `search_recipes` | Recipe library name search |
| `get_gym_today` | Schedule + session/sets for a date |
| `get_gym_progress` | Working-set history for an exercise (id or name) |
| `list_recent_mcp_writes` | Meals/foods/audit written via MCP in the last N days |

Example prompts:

- “Using FLOPS, how did yesterday’s macros sit vs my goals?”
- “Using `get_intake_weight_trend`, start 2026-08-20 end 2026-09-19 split_at 2026-09-11 — am I gaining and what’s my maintenance?”
- “Show progressive overload signals for bench press from gym progress.”

---

## 4. Write tools (propose → chat approve → commit)

Writes are **not** auto-applied. Flow:

1. Assistant calls `propose_*` → returns `proposal_id`, `confirmation_code` (e.g. `M-7F3A`), preview, warnings.
2. You approve in your own chat message.
3. Assistant calls `commit_proposal` with that code + your verbatim approval text — **never in the same turn as propose**.

The server cannot prove a human approved. Safety is: every MCP row is permanently `source: "mcp"` / `created_via: "mcp"`, audited, and bulk-undoable in the app.

| Tool | Use |
|---|---|
| `propose_meal_entry` | Pending meal: items by `label_ingredient_id`+grams, `recipe_id`+servings, or new per-100g food. Requires `weight_basis` (`raw`\|`cooked`) and per-item `nutrition_source` (`label`\|`database`\|`estimate`). |
| `propose_food_item` | Pending ingredient-library food; returns similar names for duplicate catch. |
| `propose_supplement_correction` | Pending dose_text / dose_qty / label serving fix (before/after in preview). |
| `commit_proposal` | Write the row; needs `proposal_id`, `confirmation_code`, `user_confirmation_text`. |
| `list_proposals` / `discard_proposal` | Inspect or drop pending proposals (expire after **1 hour**). |

Idempotency: pass `operation_id` on propose; retries reuse the same proposal / committed result.

**In the app:** MCP meals show an **MCP** badge. A dismissible Today banner appears when MCP wrote meals in the last 24h, with multi-select bulk undo (manual entries are never deleted).

---

## 5. Local smoke test

```bash
export MCP_API_TOKEN=dev-local-token
# optional: MCP_USER_ID=1
cd server && npm run dev

curl -s -X POST http://localhost:3001/mcp \
  -H "x-api-key: $MCP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

You should see `serverInfo.name: "flops"`.

---

## 6. Future

- Richer gym progressive-overload helpers once the workout logger is your daily driver.
- IP allowlist for Anthropic egress.
- Multi-user MCP tokens when more than one person uses FLOPS.
