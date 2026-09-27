# FLOPS MCP connector

Model Context Protocol endpoint so Claude (or another agent) can analyze FLOPS data
and write meals, foods, and supplement dose fixes directly (low-volume convenience).

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
| `get_day` | One day: meals (with `id` + ingredients), totals, supplements, goals, vs-range, weight |
| `get_log_range` | Daily summaries (optional full entries with ids); max 90 days |
| `get_goals` | Weekly min/max macros for a date |
| `get_body_weights` | Weight history |
| `get_intake_weight_trend` | Intake averages + OLS weight slope/SE + inferred maintenance (max 90 days; optional `split_at`) |
| `get_profile` | Profile / units |
| `get_supplements_range` | Taken supplements with dose-scaled macros/micros |
| `list_supplements` | Full supplement library (IDs + per-label-serving macros/micros); optional `include_deleted` |
| `get_micronutrient_totals` | Summed micros over a range |
| `search_recipes` | Recipe library name search |
| `search_ingredients` | Ingredient library by name/brand — use these IDs in `log_meal`. Supports `offset` (paginate past the 50-row page) and `has_micros` (`true`/`false` filter). Returns `{ingredients, total_matched, limit, offset}`. `per_100g` is null when `grams_per_serving` is missing or &lt; 3g. |
| `query` | Read-only SQL (`SELECT` / `WITH … SELECT`). CST-parsed (`sql-parser-cst`), runs on a separate `{readonly:true}` connection with per-user TEMP VIEW shadows. Max **1000** rows (`truncated` + `total_matched`); **5s** Worker timeout. Auth tables (`users`, `sessions`, …) are empty-shadowed. Prefer convenience tools for scaled micros / intake trends. |
| `describe_schema` | Columns, types, FKs for tables `query` can see (allowlisted only; auth tables omitted). Call this before inventing column names. |
| `get_gym_today` | Schedule + session/sets for a date |
| `get_gym_progress` | Working-set history for an exercise (id or name) |
| `list_recent_mcp_writes` | Meals/foods/audit (with `audit_id`) written via MCP |

Example prompts:

- “Using FLOPS, how did yesterday’s macros sit vs my goals?”
- “Search ingredients for chicken, then log 150g cooked for lunch.”
- “List every ingredient missing micros (`has_micros: false`), paginating with `offset` if needed — or `query` `SELECT id, name FROM label_ingredients WHERE micros_json IS NULL`.”
- “Using `get_intake_weight_trend`, start 2026-08-20 end 2026-09-19 split_at 2026-09-11 — am I gaining and what’s my maintenance?”
- “Show progressive overload signals for bench press from gym progress.”

---

## 4. Write tools (direct — no propose/commit)

Writes **commit immediately**. Safety is undo, not a handshake: every MCP row is permanently `source: "mcp"` / `created_via: "mcp"`, audited (with `audit_id`), and bulk-undoable in the app. Meal deletes are **soft** (`log_entries.is_deleted=1`) and undoable with `revert_mcp_write`. Soft-deleted meals are excluded from day/history totals (app delete uses the same soft-delete).

**`weight_basis` rule:** item-level overrides meal-level. If an item cites a library ingredient whose stored `weight_basis` disagrees with the resolved value, the write is **refused** (no raw↔cooked conversion).

| Tool | Use |
|---|---|
| `log_meal` | Log a meal now; returns entry + day totals/`vs_goals`. Prefer `search_ingredients` IDs. |
| `add_food_item` | Create a library food. Highly similar names are **refused** unless `allow_duplicate: true`. |
| `update_food_item` | Patch a food (incl. `micros` per serving or `micros_per_100g`); before/after. Writes `label_ingredients.micros_json`. |
| `update_meal_entry` | Change date/slot/items; before/after + day totals. Item replace soft-deletes old id. |
| `delete_meal_entry` | Soft-delete a log row (revertible via `revert_mcp_write`). |
| `update_supplement` | Dose fields and/or per-label-serving macros/micros; `historical_totals_recalculate` when nutrition changes (past taken days recalculate on read). |
| `write_batch` | Multiple ops in one transaction. `add_food_item` can set `ref`; later `log_meal` items use that `ref`. Failure rolls back all. |
| `revert_mcp_write` | Undo a prior MCP write by `audit_id` (creates soft-removed, updates restored, soft-deletes undeleted). |

Warnings (fiber missing, micros missing, 4/4/9 mismatch, wild quantities) come back in the response and never block a write.

**Unknown parameters are refused** (`code: "UNKNOWN_PARAM"`) — write tools never silently drop fields. Zod schemas are `.strict()`, and handlers also reject keys outside each op’s allowlist (including nested `write_batch` steps).

**Ingredient micros:** `update_food_item` / `add_food_item` store the standard per-serving blob on `label_ingredients.micros_json` (`{ micros, confidence, notes, version, estimatedAt }`). `micros_per_100g` is scaled by `grams_per_serving/100` (requires usable gps ≥ 3). **`micros_confidence` is required** when writing micros (`high` = label-exact, `medium` = USDA/database, `low` = guess) — not hardcoded. Confidence is **scalar per ingredient blob** today (day UI takes the lowest across meals); a per-nutrient map would need a schema bump + merge/UI work.

**Part B (meal micros):** Reads **live-scale** from that ingredient column (`server/entryMicros.js`) using logged `ingredients_json` amounts. New meal logs no longer freeze AI estimates onto `log_entries.micros_json`. History + MCP prefer live values; legacy frozen blobs are fallback only. `get_micronutrient_totals` returns `coverage`, `avg_daily`, and `pct_of_daily_target`.

Idempotency: pass `operation_id`; retries return the prior result without duplicating.

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

- Richer gym progressive-overload helpers.
- IP allowlist for Anthropic egress.
- Multi-user MCP tokens when more than one person uses FLOPS.
