# FLOPS MCP connector (analyze-only)

Read-only Model Context Protocol endpoint so Claude (or another agent) can analyze your FLOPS data — macros, micros, weight, supplements, recipes, and gym sessions — without writing meals.

**URL:** `https://flops-c6ic.onrender.com/mcp`  
**Auth (either):** `Authorization: Bearer <MCP_API_TOKEN>` **or** `x-api-key: <MCP_API_TOKEN>`  
**Transport:** Streamable HTTP (stateless)

**Claude.ai:** Choose **No sign-in**, then add Request header `x-api-key` = your token (no `Bearer` prefix). Do **not** use OAuth Client ID. Avoid `Authorization` in Request headers — Claude may incorrectly start OAuth. If you only see a failing **Connect** button, remove the connector and re-add with No sign-in + `x-api-key`.

Logging stays in the FLOPS app for now. Meal-write tools can land in a later pass.

---

## 1. Render env vars

On the API web service (`flops-c6ic`), set:

| Variable | Required | Notes |
|---|---|---|
| `MCP_API_TOKEN` | Yes | Long random secret (e.g. `openssl rand -hex 32`) |
| `MCP_USER_ID` | No | FLOPS `users.id` to read. Defaults to the first user (owner). |

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

If Flops already exists and **Connect** fails with “Couldn't register with … sign-in service”, **remove** it and re-add with the steps above. That Connect path is OAuth; FLOPS does not speak OAuth.

**Claude Code** (Bearer works reliably):

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer $MCP_API_TOKEN" \
  flops https://flops-c6ic.onrender.com/mcp
```

Optional hardening later: restrict `/mcp` to Anthropic egress `160.79.104.0/21` (see `docs/future/deployment-and-mcp.md`).

---

## 3. Tools (all read-only)

| Tool | Use |
|---|---|
| `get_day` | One day: meals, totals, supplements, goals, vs-range, weight |
| `get_log_range` | Daily summaries (optional full entries); max 90 days |
| `get_goals` | Weekly min/max macros for a date |
| `get_body_weights` | Weight history |
| `get_profile` | Profile / units |
| `get_supplements_range` | Taken supplements with dose-scaled macros/micros |
| `get_micronutrient_totals` | Summed micros over a range |
| `search_recipes` | Recipe library name search |
| `get_gym_today` | Schedule + session/sets for a date |
| `get_gym_progress` | Working-set history for an exercise (id or name) |

Example prompts:

- “Using FLOPS, how did yesterday’s macros sit vs my goals?”
- “Summarize my micronutrients for the last 7 days.”
- “What’s my weight trend over the last 30 days?”
- “Show progressive overload signals for bench press from gym progress.”

---

## 4. Local smoke test

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

## 5. Future

- Write tools (`log_meal`, etc.) — confirm-first — when you want Claude to push meals.
- Richer gym progressive-overload helpers once the workout logger is your daily driver.
- IP allowlist for Anthropic egress.
