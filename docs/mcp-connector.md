# FLOPS MCP connector

Model Context Protocol endpoint so any AI harness (Claude, Cursor, etc.) can **read and
edit all of one user’s FLOPS notebook data** — meals, recipes, ingredients, supplements,
goals, profile, weights, and gym — without ever seeing another user’s rows.

**URL:** `https://flops-c6ic.onrender.com/mcp`  
**Auth (either):** `Authorization: Bearer <MCP_API_TOKEN>` **or** `x-api-key: <MCP_API_TOKEN>`  
**Transport:** Streamable HTTP (stateless)

**Claude.ai:** Choose **No sign-in**, then add Request header `x-api-key` = your token (no `Bearer` prefix). Do **not** use OAuth Client ID. Avoid `Authorization` in Request headers — Claude may incorrectly start OAuth. If you only see a failing **Connect** button, remove the connector and re-add with No sign-in + `x-api-key`.

---

## Contract

- **One user per token.** `MCP_USER_ID` (or the first user) is closed over into every tool. There is no way to pass another `user_id`.
- **Reads:** convenience tools + guarded `query` (SELECT/WITH only, TEMP VIEW shadows filter `user_id`).
- **Writes:** domain tools only (no SQL writes). Commit immediately; audited; meal soft-deletes are revertible.
- **Out of scope for MCP:** barcode/OCR/DSLD/AI estimate proxies, prep lists, coach, auth — use the app for those.

---

## 1. Render env vars

On the API web service (`flops-c6ic`), set:

| Variable | Required | Notes |
|---|---|---|
| `MCP_API_TOKEN` | Yes | Long random secret (e.g. `openssl rand -hex 32`) |
| `MCP_USER_ID` | No | FLOPS `users.id` to read/write. Defaults to the first user (owner). |

Redeploy after saving. Until `MCP_API_TOKEN` is set, `/mcp` returns **503**.

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
| `get_intake_weight_trend` | Intake averages + OLS weight slope/SE + inferred maintenance |
| `get_profile` | Profile / units |
| `get_supplements_range` | Taken supplements with dose-scaled macros/micros |
| `list_supplements` | Full supplement library (IDs + per-label-serving macros/micros) |
| `get_micronutrient_totals` | Summed micros over a range (includes supplements by default) |
| `search_recipes` | Recipe library name search |
| `search_ingredients` | Ingredient library by name/brand — prefer these IDs in `log_meal` |
| `get_gym_today` | Schedule + session/sets for a date |
| `get_gym_progress` | Working-set history for an exercise |
| `query` | **SELECT / WITH only** ad-hoc SQL. User-scoped via TEMP VIEWs; `main.`/`temp.` refused; secrets (`users`, `sessions`, …) return empty. Max 200 rows. |
| `list_recent_mcp_writes` | Meals/foods/audit (with `audit_id`) written via MCP |

**Omega-3 / fish oil tip:** day omega progress lives on **History** (and `get_micronutrient_totals`), not the Today dashboard. Supplements need `micros_json` with `omega3_epa_mg` / `omega3_dha_mg` **and** `taken=1` for that date. Bare “total omega-3” DSLD labels without an EPA/DHA split store no micros — set them via `update_supplement` / `create_supplement`.

---

## 4. Write tools (direct — no propose/commit)

Writes **commit immediately**. Safety is undo + audit, not a handshake. Meal deletes are **soft** (`is_deleted=1`) and undoable with `revert_mcp_write`.

### Meals & foods

| Tool | Use |
|---|---|
| `log_meal` | Log a meal; prefer `search_ingredients` IDs |
| `add_food_item` | Create library food (`micros_confidence` required when writing micros) |
| `update_food_item` | Patch food + micros blob |
| `update_meal_entry` | Change date/slot/items |
| `delete_meal_entry` | Soft-delete a log row |
| `delete_food_item` | **Hard**-delete a label ingredient (matches HTTP) |
| `write_batch` | Multi-op transaction (meal/food/supplement update ops) |
| `revert_mcp_write` | Undo by `audit_id` |

### Recipes

| Tool | Use |
|---|---|
| `create_recipe` | Create with macros + optional `ingredients` JSON |
| `update_recipe` | Update (past `log_entries` keep denormalized macros) |
| `delete_recipe` | Soft-delete |
| `reactivate_recipe` | Bump limited-use remaining_uses |

### Supplements / goals / profile

| Tool | Use |
|---|---|
| `create_supplement` | Create (pass EPA/DHA as `omega3_epa_mg` / `omega3_dha_mg`) |
| `update_supplement` | Dose, name, `counts_toward_macros`, micros, `taken` + `taken_date` + optional `day_dose_qty` |
| `delete_supplement` | Soft-delete |
| `upsert_goals` | Goal version: `effective_start_date` + `goals[]` (weekday 1–7) |
| `update_profile` | Profile / units / dashboard prefs |
| `upsert_body_weight` / `delete_body_weight` | Weight log |

### Gym

| Tool | Use |
|---|---|
| `create_gym_exercise` | Custom exercise |
| `create_gym_template` / `update_gym_template` / `delete_gym_template` | Templates (soft-delete) |
| `add_template_exercise` / `update_template_exercise` / `delete_template_exercise` | Template lines |
| `upsert_gym_schedule` | Weekly `days[]` |
| `create_gym_session` / `update_gym_session` | Sessions (`finish: true` ends) |
| `add_gym_set` / `delete_gym_set` | Sets (`is_1rm` upserts tested 1RM) |
| `upsert_one_rm` | Manual 1RM |

**Unknown parameters are refused** (`UNKNOWN_PARAM`). Idempotency: pass `operation_id`.

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

- IP allowlist for Anthropic egress.
- Multi-user MCP tokens when more than one person uses FLOPS.
- Richer gym progressive-overload analysis helpers (reads already exist).
