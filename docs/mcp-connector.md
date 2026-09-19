# FLOPS MCP connector (analyze-only)

Read-only Model Context Protocol endpoint so Claude (or another agent) can analyze your FLOPS data — macros, micros, weight, supplements, recipes, and gym sessions — without writing meals.

**URL:** `https://flops-c6ic.onrender.com/mcp`  
**Auth:** `Authorization: Bearer <MCP_API_TOKEN>`  
**Transport:** Streamable HTTP (stateless)

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

1. Claude app → **Settings** → **Connectors** (or Custom connectors) → **Add**.
2. URL: `https://flops-c6ic.onrender.com/mcp`
3. Auth: **static headers** / Bearer — value:
   ```
   Authorization: Bearer <your MCP_API_TOKEN>
   ```
4. Save and enable the connector in a chat.

Works on Claude mobile, web, and Desktop when custom connectors are available on your plan.

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
  -H "Authorization: Bearer $MCP_API_TOKEN" \
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
