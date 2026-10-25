# FLOPS — Handoff / Current State

_Last updated: 2026-10-24 (README.md + MIT LICENSE for open-source release — branch `noggin/flops/readme-mit-license-ab15dc-1`, awaiting 🔀)_
_Last updated: 2026-10-20 (privacyIsolation "socket hang up" flake fixed in the test harness — branch `noggin/flops/stability-privacyisolation-tes-013e6a-1`, awaiting 🔀; 2026-10-19: Today 390px polish; 2026-10-18: Download my data: `GET /api/me/export` + Profile row — branch `noggin/flops/privacy-readiness-a-user-data--6ee8c6-1`, awaiting 🔀; earlier the same day: Report a problem, privacy isolation tests, demo seed)_
_Last updated: see git log for recent changes._

> **▶ Product north star:** FLOPS is a **notebook** — see **`docs/philosophy-notebook.md`**.
> Viewing day does not auto-flip at midnight; coach tools are read + summarize.
>
> **Auth / onboarding / coach** are live: Bearer sessions (email OTP + Apple/dev),
> first-run onboarding, invite codes, consent scopes, Coach roster + soft suggestions.
>
> **Questlines:** feature work (Build) lives here; going public — open source, then a
> ChatGPT/Claude connector — is the **Release** questline in **`docs/questlines/release.md`**.
>
> **Deploy:** **LIVE** — see [Deploy (live)](#deploy-live) below and **`docs/deploy-checklist.md`**.

Snapshot of where the app stands so any session (human or agent) can pick up quickly.
For conventions, architecture, and the phase vision, see **`CLAUDE.md`** — this file is the
_current-state_ companion to it.

> **⚠️ Canonical repo:** work from a clean clone of the repo (not a stale or
> iCloud-synced copy). Make sure your checkout matches what is deployed before starting.

---

## Recent changes (read this first)

**UI polish 5/35 — Label crop modal at 390px (2026-10-25, branch `noggin/flops/polish-label-crop-modal-390px-7b0536-1`, awaiting ✅):**
- Inline styles in `LabelCropModal.jsx` replaced with scoped `.label-crop-modal` CSS classes appended
  at the end of `index.css`. Design tokens for spacing, typography and colors; ✕ sized to 44px touch
  target; image canvas gets `border-radius` and `overflow: hidden`; selection border uses
  `--color-link` token. Pattern mirrors barcode-modal / log-meal-modal. Crop and canvas logic untouched.
**Release — README + MIT LICENSE (2026-10-24, branch `noggin/flops/readme-mit-license-ab15dc-1`, awaiting 🔀):**
- `LICENSE`: standard MIT license, copyright "Diego Ramirez and contributors", 2026-present.
- `README.md`: what FLOPS is, what it does, how to run locally, tech stack, tests, and the license.
  Written in the notebook voice (no hype, no exclamation marks). Does not mention unbuilt features
  (bridge, connector, open sign-up), deployment hosts, or personal details beyond the copyright line.
  Links to `docs/philosophy-notebook.md` for design philosophy.
- No other files changed. Server (510) and client (371) tests pass; Playwright e2e could not run
  (Chromium download timed out — network issue, not code-related; the change is two text files).

**UI polish 4/35 — Barcode scanner modal at 390px (2026-10-22, branch `noggin/flops/polish-barcode-scanner-modal-3-35367e-2`, awaiting ✅):**
- The scanner card's inline styles moved into one `.barcode-modal` block appended at the end of
  `index.css` (after the `::backdrop` rule). The `<dialog>` wrapper, its inline full-screen styles
  and its showModal/cancel/close wiring are untouched; so is all scanning logic.
- One rhythm top to bottom: title → how-to line (4px) → viewfinder (12px) → notice → warm rule →
  typed entry → Cancel (20px). ✕ grows to 44px. The not-found notice uses the `--status-partial-*`
  tokens instead of hardcoded ambers, and the invalid-number hint uses `--color-warning-ink` so it
  reads as a state rather than more help text. Copy unchanged.

**Bug fix — barcode scanner hidden behind Add ingredient (2026-10-22, branch `noggin/flops/bug-redo-for-auto-ship-barcode-292dc7-2`; supersedes `…-292dc7-1`):**
- Library → + Add ingredient → Scan barcode opened the scanner *under* the form: the form is a
  `showModal()` dialog (browser top layer) and the scanner was a z-index 200 div, which can't draw
  above the top layer. Broken since the scanner landed (c7e16f9).
- `BarcodeScannerModal` now renders its wrapper as a native `<dialog>` opened with `showModal()`, so it
  stacks above whatever dialog is open. Escape (`cancel`) and a browser-initiated `close` both go
  through `onClose`, so the camera stops as with ✕. `.barcode-scan-dialog::backdrop` (end of
  `index.css`) is transparent since the wrapper paints its own dim. Markup, copy and scanning logic unchanged.
- Tests: `BarcodeScannerModal.layer.test.jsx` (vitest repro: inside a `showModal()` dialog the scanner
  must be its own `<dialog>` opened with `showModal()`; fails on 78e61ed), `client/e2e/barcode-scanner.spec.js` (390px, `/api/barcode/*` stubbed with a synthetic
  product); `test-setup.js` polyfills jsdom's missing `HTMLDialogElement.showModal/close`.
**UI polish 2/35 — Log Meal modal at 390px (2026-10-20, branch `noggin/flops/polish-log-meal-modal-390px-sc-7210c1-1`, awaiting ✅):**
- The modal's inline styles (dialog size, header, "What's in this meal" panel, substitutes subpanel,
  meal total + "After this meal" preview) moved into `.log-meal-modal` / `.log-meal-items` /
  `.log-meal-subs__*` / `.log-meal-total` / `.log-meal-day-preview__*` classes in `index.css`.
- Phones (≤480px): close ✕, row ✕ and the recipe-chip ✕ are 44×44, "Reset to recipe" and substitute
  options 44px tall; the add-food row's search spans the whole row (the 40 / g ghosts hide) so the
  placeholder isn't clipped; dialog padding 20/16 to give the ingredient list room.
- Per-line macros keep each letter with its number (non-breaking spaces), so "C 0.0" no longer splits.
- Shared `slot-row` / `slot-list` changes are all scoped under `.log-meal-modal`; the supplements,
  AI logger and meal-prep modals keep their sizing. /meal-builder renders pixel-identical before/after.
**UI polish 3/35 — AI macro logger at 390px (2026-10-21, branch `noggin/flops/polish-ai-macro-logger-390px-s-4e4675-1`, awaiting ✅):**
- The `/ai-logger` page and the Today modal (`AiLoggerModal`) now style through one scoped block in
  `index.css` (`.ai-logger*`, `.ai-logger-modal*`, `.ai-fixups*`, `.ai-voice*`, `.ai-followup-panel__*`),
  placed right after `.ai-followup-panel`. Inline styles are gone except data-driven colours
  (ingredient source, confidence). No shared, token or Log Meal rules changed.
- Inside the modal the input/review card drops its own surface (the dialog is the surface); close ✕ is 44px.
- Every control is ≥44px: Pick ingredient, Use this/Cancel, Keep in recipe, Not a meal prep,
  ingredient chips, "Not this recipe?" link, row summaries and the save-to-library checkbox row.
- Paired actions (Speak a meal + Generate estimate, Log once + Save as recipe, Log recipe + Cancel)
  split the row equally. The estimate card's title now sits above the conversation like the recipe
  review's, and the recipe review's "Anything to adjust?" now sits above "Log to", as in the estimate.
- The description textarea uses the app font instead of the browser's monospace default.
**Stability — privacyIsolation flake (2026-10-20, branch `noggin/flops/stability-privacyisolation-tes-013e6a-1`, awaiting 🔀):**
- Cause: `request(app)` opens a server per request with `app.listen(0)`, which binds `::`, then
  supertest dials `127.0.0.1:<port>`. On macOS that wildcard bind can share a port another local
  process holds on 127.0.0.1, and the connection goes to that process instead ("socket hang up").
- Fix, test harness only: `listenTestServer(app)` / `closeTestServer(server)` in
  `server/__tests__/helpers.js` listen once per test on 127.0.0.1; `privacyIsolation.test.js` passes
  that server to supertest. No app code, assertions or timeouts changed.
- Other suites still use `request(app)`; switch them to the helpers if they ever hang up the same way.

**UI polish 1/35 — Today at 390px (2026-10-19, branch `noggin/flops/polish-today-dashboard-390px-s-956687-1`, awaiting ✅):**
- One surface per Today card: `SupplementStrip` no longer draws its own `.card` inside the dashboard
  card, and the meals list runs edge to edge of its card (dividers only) instead of a nested box.
- Card headers share one 12px rhythm; "Manage" / "Full history" use `.dash-card-link` (13px text,
  44px hit area). The toolbar's Profile link and the MCP-writes pill buttons also reach 44px.
- `.dashboard-stack` dropped its top margin, so the greeting → first card gap is the row's 24px.
- Adherence and Prep are not rendered on Today (Prep is vaulted behind `SHOW_PREP_PLAN`), so nothing changed there.

**Privacy readiness (b) — account delete (2026-10-19, branch `noggin/flops/privacy-readiness-b-account-de-7a8b34-1`, awaiting 🔀; not a bugfix, never auto-ships):**
- `POST /api/me/delete-request` emails a one-time 6-digit code (Apple-only accounts get a challenge
  for an Apple re-sign-in instead; that path is AUTH_DEV-only, like Apple sign-in itself).
  `DELETE /api/me` with the code then deletes. Codes live in their own table
  (`account_delete_challenges`, hashed, 10 min, 5 tries), so a login code never confirms a delete; a
  used, superseded or expired code is refused with 403 (not 401, which the client treats as signed out).
- The delete (`deleteAccount` in `server/routes/me.js`, one transaction) sets `users.deleted_at`, flags
  the user's rows that have a soft-delete column (`softDeleteNutrition` / `softDeleteGym`, each in its
  own export module), dismisses their prep items, marks their open problem reports `account_deleted`,
  revokes coach links both ways, removes their sessions and pending codes, and writes an
  `account_deletions` row listing every flagged id (so a restore can undo exactly that). Tables
  without a soft-delete column keep their rows untouched. Nothing user-owned is hard-deleted.
- A deleted account is shut out everywhere: session lookup ignores it, sign-in again answers 403,
  `/mcp` answers 401 for it (and a deleted owner is refused, never replaced by the next user), and
  coach roster / my-coaches / invite codes / suggestion inbox skip it.
- Schema: two new tables + `users.deleted_at` (added columns only, no existing data edited).
- Export now also covers coach suggestions, `day_prep_items` (minus dismissed), `prepped_batches`,
  problem reports and the legacy `training_*` / `workout_day_selections` tables (export `version: 2`).
- Profile: "Delete my account" row under "Download my data" → dialog with two steps (what it means
  plus "Download your data first", then the code). Component `features/profile/DeleteAccount.jsx`.
- Tests: new export + delete blocks in `privacyIsolation.test.js`, `DeleteAccount.test.jsx`, and a
  390px mobile smoke step that deletes a throwaway local account.
- **Flaky:** `privacyIsolation.test.js` run alone 10× passed 8/10. Both failures were supertest
  `socket hang up`, each in a different test (none an assertion). Not fixed here.

**Privacy readiness (a) — data export (2026-10-18, branch `noggin/flops/privacy-readiness-a-user-data--6ee8c6-1`, awaiting 🔀):**
- `GET /api/me/export` (`server/routes/me.js`, own 10/min rate limit) returns the caller's own rows as
  one JSON file: account, nutrition (`server/nutritionExport.js`), training (`server/gymExport.js`,
  gym + legacy presets/exercise logs), coach links (ids + scopes only, both directions) and
  `mcp_write_audit` rows. Soft-deleted rows are left out; no migration.
- "Download my data" row in the Account card on Plan → Profile (`.data-export-row` in `index.css`).
  The client names the file (`flops-export-YYYY-MM-DD.json`) because the API is cross-origin and
  the browser hides `Content-Disposition`.
- Tests: new export block in `privacyIsolation.test.js` (A↔B in every section, soft deletes, 401,
  coach link doesn't widen) and a mobile smoke step that downloads the file at 390px.
- The tables it skipped are covered since privacy readiness (b) above.

**Launch prep (2026-10-18, branch `noggin/flops/launch`, awaiting 🔀):**
- **Report a problem:** a quiet link under every app screen (`shared/ui/ReportProblem.jsx`) posts to
  `POST /api/problem-reports`. The table `problem_reports` holds only text, route (path only),
  app_version (server git sha), user_id, created_at and status. `GET /api/problem-reports` lists `new`
  report rows only and needs `x-api-key: $PROBLEM_REPORTS_TOKEN`. **The admin sets that env var on Render**,
  and the inbox answers 503 until he does. Tests: `server/__tests__/problemReports.test.js`, the vitest
  for the form, and a mobile smoke step.
- **Privacy isolation:** `server/__tests__/privacyIsolation.test.js` checks that user B can't touch A's
  rows via REST, `/api/gym`, the MCP tools, `write_batch` or revert, and that coach access follows the
  consent scopes and stops on revoke. No gaps found. Note: MCP is still single-user (`MCP_USER_ID`),
  so the public connector needs per-user auth.
- **Demo data:** `cd client && npm run demo:screenshots` seeds `.demo/demo.db` (fake user
  `demo@flops.example`) and writes 390px PNGs per route to `.demo/screenshots/` (gitignored).
  Known quirks: in full-page shots the fixed bottom nav lands mid-page, and Today's meal card can
  come out blank.

**Diet-phase badges (2026-10-09):** the adherence calendar (Review + Today's calendar card) has a
`+ Phase` button; phases (free-text **name**, required; optional color category cut / bulk /
maintenance / recovery / other that auto-guesses from the name; optional notes; optional end = ongoing) show as a badge on the start day, colored bars on covered days, and a chip
list under the legend (click to edit/delete). Table `diet_phases`, logic in `server/dietPhases.js`,
route `/api/diet-phases`. MCP: `get_diet_phases`, `add_/update_/delete_diet_phase` (+ `write_batch`,
revert); `get_day` returns `diet_phases`. Tests: `server/__tests__/dietPhases.test.js`.
**Status:** Active. Nutrition daily driver + Log Meal UX; MCP Phase 3 + lookup tools.
**Part A shipped:** placeholder `grams_per_serving` (&lt;3g) no longer derives `per_100g`;
writes reject those values; boot repair nulls unit cosmetic ids and flips rice cakes/
onion bagel (11/22/34) to unit tracking.
**MCP micros write path shipped:** `update_food_item` / `add_food_item` persist
`micros` / `micros_per_100g` → `label_ingredients.micros_json` (per-serving blob).
`micros_confidence` (`high|medium|low`) is required when writing micros.
**Part B shipped:** meal micros are **live-scaled on read** from ingredient-library
`micros_json` (`server/entryMicros.js`). New logs no longer freeze AI estimates onto
`log_entries.micros_json`. History/`get_day`/`get_micronutrient_totals` prefer live
values; legacy frozen blobs remain as fallback. `get_micronutrient_totals` returns
coverage + `avg_daily` + `pct_of_daily_target`.
**Micros accuracy pass:** an audit found some foods silently counted as
zero micros (items without library micros) and label blobs carrying
only the ~5 printed nutrients. Fixes: (1) `resolveEntryMicros` names uncovered rows in
`missing_ingredients`; UI (meal + day panels), `get_day` (`micros_missing_ingredients`) and
`get_micronutrient_totals` (`coverage.ingredients_missing_micros`) show them as "not counted".
(2) `server/ingredientMicros.js` fills each library ingredient's ABSENT nutrients once with an
AI estimate per serving — stored/label values never overwritten, `filled_keys` +
`completed_at` on the blob; runs after ingredient create/edit and as a production boot
backfill (`MICROS_BACKFILL=1` to run elsewhere). (3) log-time `mergeMicros` now ADDS label +
estimate (they cover different rows) instead of label replacing estimate.
MCP `get_ingredient` shows one row's stored micros (per serving + per 100g, `estimated_keys`,
`zero_keys`, `absent_keys`) for tracing a meal total to its ingredient. Note: a stored 0 blocks
the gap-fill.
**AI-fill scaling fix:** when asked for a whole weighed serving (e.g. "28 g feta",
"85 g spinach"), the estimator returned food-table values **per 100 g** as the serving.
`servingLine` now asks for **100 g** (macros per 100 g) and `scaleEstimate` scales to the
stored serving. Estimator prompt (`microEstimateService.js`) now says vitamin A is mcg RAE,
never IU.
**Library re-audit (done):** every ingredient row checked via MCP `get_ingredient`.
Older app-era rows are fine: their AI-filled keys are small (biotin/B12/D/iodine), USDA keys
are right. The per-100g-as-serving bug only hit whole-blob AI fills — affected rows were
corrected. Common patterns found: IU-stored-as-mcg (vitamin A), overestimated values
(e.g. thiamin 10x), incorrect EPA/DHA, and unit-tracked foods with stray `grams_per_serving`.
**Potential data issues to watch for:** dry-mix macro matches on sauces, zero-sodium on spice
mixes that contain salt, IU/mcg confusion on fortified cereals, low vitamin C on fruit blends,
`grams_per_unit` near zero, wrong-food matches from ingredient name ambiguity, duplicate
ingredient rows, and minor copper/manganese/vitamin E estimation variance.
**Servings per container:** `label_ingredients.servings_per_container` (ingredient
form, REST, MCP add/update; reads expose `container` totals). Meal Builder shows "+ 1 container"
per row. Not yet in the Log Meal modal.

**Last active work stream:** `create_meal_prep` MCP write tool — agents save a batch
as an equal-split limited-use recipe (whole-batch grams in, per-container recipe out;
also a `write_batch` op, revertible). MCP meal writes now do limited-use accounting
like `/api/log`: `log_meal` charges a use per serving (refuses when out, and refuses
mixing a prep container with other foods); `delete_meal_entry`, `update_meal_entry`
and `revert_mcp_write` hand uses back / re-charge them.
**Fixed:** MCP `log_meal` single-recipe logs now store the same per-serving
`ingredients_json` snapshot as `POST /api/log` (shared `receiptFromRecipeTemplate` in
`recipeIngredients.js`), so their micros resolve live like app logs; recipe items keep
the caller's `nutrition_source`. Boot repair `repairMcpRecipeEntrySnapshots` (db.js)
backfilled older MCP recipe logs with a NULL snapshot.

**MCP logging friction:**
- *Shipped (PR #28):* `search_ingredients` takes `queries[]`, so a whole meal resolves in one
  call (one result group per query, `limit` per query, default 5). Write responses' `day.meals`
  is now a compact `{id, name, time_min, servings, logged}` instead of a copy of every meal's
  ingredients + micros (the written entry is already in the response; `get_day` has the full meals).
- *Shipped (PR #29):* **ingredient density**.
  `label_ingredients.grams_per_ml` is a second unitConvert bridge (beside `grams_per_unit`), and
  every cross-family conversion goes through grams. A weighed food with a density takes volume
  units; a per-ml liquid takes grams from the density alone; a counted food takes volume with both.
  No density means no change. MCP add/update_food_item accept it (0.1–5, revertible);
  `search_ingredients` returns `grams_per_ml` + `loggable_units`. The REST route reads/writes it and
  an edit that omits it keeps it. **No UI field yet**: it is set via MCP only, though the Log Meal unit
  picker already offers volume units once a row has one.
- *update_food_item response trimmed:* over MCP it returns `changed{field:{before,after}}` plus
  `micros_changed{nutrient:{before,after}}` instead of two full rows with raw `micros_json` (also
  per step inside `write_batch`). The audit row and the batch's stored response still keep the full
  before/after, because `revert_mcp_write` reads them. Trim happens in `createMcpServer.js` via
  `compactFoodUpdate` / `compactBatchResponse`.
- *update_recipe:* MCP write that replaces a saved (non-prep) recipe's lines per serving and optionally
  its name; macros recomputed via `resolveReceiptForLog`; drops stale `meal_builder_meta.lines`; past
  log entries untouched; revertible (refused if the recipe changed since). Recipes with broken
  ingredient lines (e.g. items showing as "3 g" or "1 g" with wrong IDs) can be corrected
  using this tool.
- *get_recipe per-line errors:* each line resolves on its own, so a broken line comes back with
  `error` + `hint` (the units its food can be measured in) instead of an empty `lines` array.
  Common unit-tracked ingredients (eggs, bread slices) need correct `grams_per_unit` values for
  recipe lines to resolve.
- *Maintenance calories:* read tool `estimate_maintenance` (default 28 days ending yesterday)
  infers maintenance as avg intake − weight slope × density / 7 at 3500 (all fat) and 2500 (mixed
  tissue) kcal/lb, plus ±1 SE of the slope; returns estimate, range, confidence, coverage warnings
  and the profile value. Write tool `set_maintenance_calories` (1000–6000 or null, revertible,
  batchable; revert refuses if the Profile page changed it since).
- *Recipes with today's amounts:* new read tool `get_recipe` (lines with label_ingredient_id, amount,
  unit, macros per serving). `log_meal` recipe items take `adjust: [{label_ingredient_id,
  quantity_g | quantity+unit | remove: true}]` (per serving), resolved through `resolveReceiptForLog`
  like the app's log-time receipt edits. One recipe plus adjust and/or extra foods is stored as ONE
  entry linked to the recipe (`insertRecipeWithChanges`, which also handles meal prep add-ons); several
  recipes still flatten to a quick-food meal. `update_meal_entry` no longer returns `items_resolved`
  over MCP.
- *Meal prep container + add-ons:* `log_meal` takes one limited recipe plus add-on foods (label
  ingredients / new foods) as ONE entry against the prep recipe, so the use counts down and is handed
  back on delete. Entry macros are per serving (totals ÷ servings); add-on rows are divided by servings
  and flagged `add_on: true` in `ingredients_json` next to the recipe snapshot, so micros count both.
  A prep with another recipe or a second prep is still refused (`MEAL_PREP_MIXED`). Default name:
  "<prep> + <add-ons>".
- *log_meal defaults for recipes:* a meal of only saved recipes / preps no longer needs `weight_basis`
  (defaults to raw) and recipe items no longer need `nutrition_source` (defaults to database — the
  lines carry their own). Single foods still require both. Unknown params get a "did you mean" hint
  (`slot` → `meal_slot`).
- *Meal update/delete responses trimmed:* over MCP, `delete_meal_entry` / `update_meal_entry`
  return `before` as a summary `{id, name, date, servings, logged}` plus one `day` (after the
  write) instead of the full entry + `day_before` + `day_after`. `write_batch` drops per-step days
  and returns one `day` as it stands after the whole batch. Same boundary as the food-update trim
  (`compactWriteResult` / `compactBatchResponse`), so audit rows keep everything revert needs.
- *Search ranking:* `searchIngredients` ranks by match quality before `use_count`. The tiers are:
  exact name, whole word, word prefix, then substring, and the brand counts like the name.
  Searching "apple" used to return pineapple blends and miss the Pink Lady apple.
- *Day totals rounded:* `sumMacros` / `addMacros` round at the total (kcal 1 dp, grams 2 dp), so
  responses no longer show float noise like `184.82999999999998`.
- *Claude app tool cache:* after a deploy that adds a tool parameter, the Claude app keeps the old
  schema until the connector is refreshed, so the direct call fails ("expected number, received
  string"). `write_batch` passes operations through unchanged and works as a fallback.
- *Library data issues seen (not fixed):* duplicate ingredient rows, a `grams_per_unit` near zero,
  and zero-protein entries that should have values. Check for these after data imports.

**`log_body_weight` + server TZ:** MCP can write weigh-ins (lb/kg, same-date
overwrite like the Dashboard, `body_weights.source` = app|mcp, revertible, batchable) via the
shared `server/bodyWeights.js` upsert the REST PUT now uses too. `server/index.js` defaults
`TZ=America/Los_Angeles` (Render ran UTC, so MCP "today" flipped at 5 pm PT); also in
`render.yaml` / deploy checklist. Known UI quirk, not changed: the Dashboard weight card saves
to the *viewing* date and still says "Logged for today" on a past day.

**Unit-tracked gram weight:** unit-tracked foods have ONE gram weight,
`grams_per_unit` (what unitConvert, micros and the edit modal read). MCP used to scale them
by the stray `grams_per_serving`, so macros were right but micros silently dropped (eggs
logged as 200 g). MCP `log_meal` now uses the app's converter and takes `quantity`+`unit`
("4 egg"); grams without `grams_per_unit` are refused; dropped micros surface as warnings.
**Pending:** run `server/scripts/migrateUnitGramsPerUnit.js` (dry run, then `--apply`) on
Render to move `grams_per_serving` → `grams_per_unit` on unit rows — until then MCP can
only log those foods by count. The script also clears volume-unit rows (ml, cup…)
instead of writing "1 ml = 1 g" over a real `grams_per_ml`. Single rows can also be cleared
over MCP: `update_food_item {grams_per_serving: null}` is accepted on unit rows. Historical log rows are NOT rewritten (their micros heal live
once `grams_per_unit` is set).

**Previous work stream:** `get_server_info` MCP tool + `/health` identity
(`git_sha`, `built_at`, `process_started_at`, `tool_count`) so a deploy can be
verified without failing a write — see `docs/mcp-connector.md`.

**When you return / next picks (optional):**

1. **Backfill** — use `update_food_item` + `micros_per_100g` + `micros_confidence` (`medium` for USDA, `high` for labels); past meals pick them up live.
2. **Claude connector** — after Render redeploy, call `get_server_info` (or `curl /health`) and confirm `git_sha` matches the merged commit; refresh the connector if `tool_count` looks stale client-side.
3. **Gym UX / progressive overload** — agent can already call `get_gym_progress`.
4. **Dashboard layout editor** — **vaulted Oct 2026** (too wonky); see [§ Dashboard layout editor](#dashboard-layout-editor--vaulted-oct-2026).
5. **Ops:** Resend domain verification for production OTP email (if not done yet).

---

## Deploy (live)

| What | Where |
|---|---|
| **App** | [https://www.useflops.com](https://www.useflops.com) |
| **API** | `https://flops-c6ic.onrender.com` |
| **Frontend host** | Vercel (`client/`, auto-deploy on push to `main`) |
| **Backend host** | Render Web Service (`server/`, persistent disk at `/var/data/nutrition.db`) |
| **Backup Vercel URL** | `https://flops-amber.vercel.app` |

**Workflow:** commit + push to **`main`** → Vercel production deploy within ~1 min.
Render redeploys on push if connected to the same repo.

**Verify a deploy:** `gh api repos/TheDoc004/flops/deployments --jq '.[0] | {env:.environment, sha:.sha[0:7], created:.created_at}'`

---

## 1. What FLOPS is (one line)

A personal nutrition + training tracker, built toward eventually connecting the two
(the "bridge", Phase 3). Nutrition and Training are developed as **separate domains** —
do not import one domain's business logic into the other.

Phases: **1 Nutrition** (feature-complete for daily use), **2 Training** (gym dashboard),
**3 Bridge** (future, not started).

---

## 2. How to run

One-shot: `bash start-app.sh` from the repo root. Or two terminals:

```bash
# Terminal 1 — API (port 3001)
cd server && npm run dev

# Terminal 2 — client (Vite, port 5173, proxies /api → 3001)
cd client && npm run dev
```

SQLite DB: `server/nutrition.db` (ignore stale copy at repo root). Multi-user with auth:
Bearer session on `/api/*`; ownership via `req.user.id`. Schema + migrations are inline in
`server/db.js` (`PRAGMA table_info` + conditional `ALTER TABLE`).

> If a running API server predates a schema/route change, **restart it** — a plain
> `node index.js` will not pick up new code or run new migrations on its own.

**Tests:**

```bash
npm test --prefix server    # Jest — ~301 tests
npm test --prefix client    # Vitest unit tests — ~366 tests (excludes Playwright e2e)
npm run build --prefix client
```

**Layout editor verify harness** (Playwright — separate from `npm test`):

```bash
cd client && npm run verify:layout-editor
```

See **`docs/verify-dashboard-editor.md`**.

---

## 3. Current state by area

### Nutrition (Phase 1) — feature-complete / daily-driver ready

Dashboard, Recipe Library, Ingredient Library (OCR + barcode), Meal Builder, History/Review,
Goals, Report, Profile, Adherence, supplements, prep strip, coach, and AI Estimate all work.

**Today dashboard actions:** `AI Estimate` (`btn-ai`) and `+ Log a Meal` (`btn-primary`) in
`Dashboard.jsx` → `AiLoggerModal` / `LogMealModal`. Meal rows' ⋯ menu includes **Edit meal**,
Copy / Save as Recipe / Remove. **Training** hop (`Link` to `/training`) beside them.

**Today card order (Oct 2026):** fixed stack — Supplements, Macros, Weight, Weight trend, Meals —
from `dashboardLayout.js`. Supplements sit first so they can be checked off without scrolling.
Show/hide = tap the badges on Profile → Dashboard. Saved `dash_layout_json` is ignored (column kept).

**Prepped ingredient batches:** Cooked batches with known total weight + macros (`prepped_batches`).
**Prepped badge** (Aug 2026): active batches show a badge in ingredient library, combobox, and
log receipt lines. Entry: Ingredients → "Prep a batch".

**Augment meal prep:** Recipe Library → **Add to prep** on equal-split limited recipes. Fixed Aug 2026:
`AugmentMealPrepModal` passes `items=` (not `ingredients=`) to `IngredientCombobox`.

**Log Meal (Sept 2026):** Dual-bar flow. Top starts as recipe/ingredient search, then
**transforms** — recipe chip (with Clear) if seeded from a recipe, or editable **meal name**
if built from ingredients (empty → auto `generateMealName`). Bottom ghost row adds more
ingredients only. Ghost suggested amounts + keyboard shortcuts remain. Substitutes vaulted;
Servings UI only for limited meal prep (see Parked).

**Units & save-as-recipe:** See prior handoff detail in git history; `unitConvert.js` twin files,
Save as Recipe / Meal Prep from log modal and meal ⋯ menu. Still accurate.

### Dashboard layout editor — VAULTED Oct 2026

> Removed from the active app because drag/resize never worked well enough. The full
> editor (react-grid-layout canvas, edit context, toolbar, card scaling, Playwright verify harness)
> is preserved on the branch **`archive/dashboard-layout-editor`**. `react-grid-layout` was
> uninstalled. The notes below describe the archived code — read them before reviving it.


Today is a **card canvas** (not a fixed section stack). Registry cards:

| Card ID | Label | Notes |
|---|---|---|
| `macros` | Macros | Pinned visible; scales well in edit mode |
| `supplements` | Supplements | Profile `dash_supplements_enabled` |
| `weight` | Today's weight | Profile `dash_weight_enabled` |
| `weight_chart` | Weight trend mini | Optional; `dash_weight_chart_card_enabled` |
| `meals` | Today's meals | Profile `dash_meals_enabled` |

**Persistence:** `user_profile.dash_layout_json` (12-col grid positions). Show/hide syncs to profile flags via `profilePatchForLayout()`.

**Key files:**

```
client/src/features/dashboard/
  Dashboard.jsx              — page shell, edit banner, card content (incl. meals preview)
  DashboardCanvas.jsx        — view stack vs react-grid-layout edit grid
  DashboardCardScale.jsx     — ResizeObserver + uniform transform scale in edit cells
  dashboardLayout.js         — merge/save layout, EDIT_MIN_ROWS/COLS/SCALE, layoutToRgl
  dashboardReadability.js    — per-card scale floors (graph, macros, list, etc.)
  dashboardEditMealsPreview.js — 3 preset meals shown in edit mode (not live log)
  DashboardLayoutToolbar.jsx — show/hide chips (banner variant, off canvas)
  DashboardEditContext.jsx   — ?editLayout=1 session, dirty state, exit dialog
```

**Edit mode behavior (as shipped):**

- **View mode:** natural-height stack (`dashboard-stack`).
- **Edit mode:** `react-grid-layout` (12 cols, `EDIT_GRID_ROW_HEIGHT = 36px`), corner resize only.
- **Scaling:** card innards scale via `transform: scale()` — no internal scrollbars; overflow clipped.
- **Readable floors:** per-card `minH`/`minW` on grid items + typography-aware scale floors
  (body ≥12px, titles ≥16px). Weight chart has higher vertical floor (`minH: 7`) and chart-height floor.
- **Meals in edit mode:** live log **hidden**; fixed 3-meal preview (`Preset Breakfast/Lunch/Dinner`)
  so layout height is predictable. `minH: 2` allows tighter vertical compression than supplements.
- **Show/hide toggles:** in **Customizing Today** banner (not over the canvas). Greeting `h1` hidden in edit mode.
- **Exit dialog:** centered via `showModal()` + CSS `translate(-50%, -50%)`.

**Known rough edges (parked):**

- Scaling can still feel like it "fights" the user vs. fluid document reflow (Google Docs mental model).
- One-size-fits-all constraints were replaced with per-card rules, but **not perfect** for every card size.
- Weight chart: vertical compression was improved but may still clip before resize halts in edge cases.
- User was **not fully satisfied** with edit-mode visual parity to view mode — acceptable for now, not urgent.

**Verify tooling:** `client/e2e/layout-editor.verify.spec.js`, `npm run verify:layout-editor`.
Skill: `.cursor/skills/dashboard-layout-editor-verify/SKILL.md`.

### Notebook-day UI (off-today on Dashboard)

When viewing a non-today date on **`/`**, `Dashboard.jsx` sets `html[data-notebook-day="past"|"future"]`.

**Gotchas:** native `<dialog>` needs explicit notebook-day styles; `.btn-primary` / `.btn-ai` /
`.btn-ghost` all need overrides on charcoal (all four variants are now covered — keep it that way);
avoid hardcoded `#f9fafb` in modal JSX. See `index.css` notebook blocks.
Only Dashboard sets this attribute — other pages stay beige.

**Contrast audit + fixes (2026-09-04).** Every fg/bg pair was measured across all three themes
(today / past / future) against both `--color-surface` and `--color-bg`. Three pairs were under
WCAG AA and are now fixed:

| Token | Was | Now | Where it bit |
|---|---|---|---|
| `--color-success` | `#059669` 3.58:1 | `#047a55` 4.60:1 | `.macro-status.is-ok` at 12px; paste confirmation at 13px |
| notebook `--color-text-faint` | `#a1a1aa` 4.26:1 | `#a8a8b0` 4.63:1 | `.section-label` (11px), `.empty-state`, gym `.prev` |
| `.btn-ghost` off-today | inherited `#60a5fa` 4.30:1 | `#6dacfa` override | the 4th button variant, missing from the notebook set |

**When changing a text token, check it against `--color-bg` as well as `--color-surface`.** The first
pass only tested cards and picked `#04815a`, which passes on the card (4.65:1) but only reaches
4.20:1 on cream — success text renders directly on the page background in `Dashboard.jsx`
(the paste confirmation). `#047a55` clears both.

**Still open (found 2026-09-04, not changed):** in the *light* theme `--color-text-faint` and
`--color-text-muted` are both `#6b7280` — 4.59:1 on cards but **4.15:1 on `--color-bg`**.

Design canvases (contrast matrix and app review across all 14 routes + 5 chrome surfaces) live in
`.design/` (`gen.py` regenerates the artboards). **Note: the canvases predate
`feat(typography): Nunito headings + Open Sans UI body` and still draw DM Serif — the contrast
findings are unaffected, the type is not.**

**Nav label (settled 2026-09-04):** the top-level item for the plan section is **Profile** →
`/plan/profile`, with `matchPaths: ['/plan']` so it stays lit across the section. It was briefly
changed to "Plan" → `/plan` in `640c769` and reverted in `1bd9da2` — **Profile is the intended label.**
(For the record, the earlier "Goals" label collided with the *Goals* tab inside `PlanLayout`;
that collision is gone either way.)

### Training / Gym (Phase 2)

Separate gym dashboard at `/training`. Routes: Today, Schedule, Workouts, Progress.
Backend: `/api/gym/*` in `server/routes/gym.js`. Client: `client/src/features/training-workouts/`.
Legacy `training.js` + `workouts.js` exist; new UI uses `gym.js`. **No bridge to nutrition yet.**

### Marketing, auth, coach, supplements, barcode, AI

Still accurate from prior handoffs. Highlights: landing at `/` + `/es`, email OTP login (Resend
needs domain verification for prod delivery), DSLD supplement lookup, barcode via OFF, coach invites.

---

## 4. Git state

**Branch:** `main` · **Remote:** `origin/main` (GitHub `TheDoc004/flops`)

Recent production commits (newest first):

```
62d1cb4 feat(ingredients): vault prep batches and allow remove
2edef3d feat(log-meal): one search for recipes and ingredients
… (dashboard layout editor sprint Aug 2026 — PRs #4–#11)
```

Working tree should be clean before starting new work. **One topic per commit**; push to `main`
for live deploy (see `.cursor/rules/early-ship-and-feature-commits.mdc`).

---

## 5. Known issues & tech debt

**Not blocking daily use:**

- **Dashboard layout editor UX** — functional but not polished enough; **parked**.
- **Email OTP / Resend** — production codes fail until Resend sending domain verified on Render.
- **Oversized components:** `AiMacroLogger.jsx`, `Ingredients.jsx`, `MealBuilder.jsx`, `LogMealModal.jsx`.
- **AiMacroLogger** hardcoded light-theme inline colors in review panels (notebook-day risk).
- **Stale brand asset:** `flops-badge.png` (2MB amber lightbulb) clashes with navy/paper identity.
- **Meal Builder browser history** — mode/step pushes history entries (`{ replace: true }` fix deferred).
- **`client/package-lock.json` out of sync** with `package.json` (`npm ci` fails: missing `esbuild@0.28.2`).
  Regenerate with `npm install` in `client/`.

**Tests (Oct 2026):** server ~462 Jest; client ~381 Vitest unit. Playwright e2e specs live under
`client/e2e/` and run via `npm run verify:layout-editor`, not `npm test`.

---

## 6. Parked / deliberately deferred

- **Dashboard layout editor visual polish** — paused; app is usable without it.
- **Log Meal substitutes** — tap-name AI/heuristic swap vaulted via `SHOW_MEAL_SUBSTITUTES = false`
  in `LogMealModal.jsx`. Helpers + API remain. Swap path: ↑↓ row → ⌘⌫ remove → search add.
- **Everyday Servings field** — hidden except for limited-use meal prep (`recipe_kind === 'limited'`)
  and when editing an old log that already had `servings !== 1`. New permanent-recipe / custom logs
  always send `servings: 1`. Can rebuild later if needed.
- **Prepped batches UI** — still vaulted (`SHOW_PREPPED_BATCHES = false` in Ingredients + Log Meal).
- Goals & Profile restructure (Plan shell organization).
- Phase 3 nutrition↔training bridge — do not start until both domains feel solid independently.
- Nutrition refactors — opportunistic when touching files.
- AI Logger recipe "one-shot invert" (estimate primary, saved recipe as suggestion).

---

## 7. How work happens here (quick reminders)

- Beginner-friendly: explain non-obvious decisions; prefer the smallest change that works.
- Mobile-first always (test mentally at 390px).
- One topic per commit; don't bundle unrelated changes.
- **Do not put the repo in an iCloud-synced directory.** Work from a dedicated local path.
- **HANDOFF.md is enforced** — `.claude/hooks/check-handoff.sh` blocks Stop if source changed without updating this file.
- For UI/theming: **`docs/design-system.md`** + notebook-day section above.
- Auto-ship: push `main` after shippable work unless told otherwise.

---

## 8. Picking up after the pause

1. `git pull origin main` from the repo root.
2. Read this file + skim **`CLAUDE.md`** for architecture.
3. `cd server && npm run dev` + `cd client && npm run dev` (or `bash start-app.sh`).
4. Open the app and verify it matches `main`.
5. **If resuming layout editor:** start with `client/src/features/dashboard/`, run
   `npm run verify:layout-editor` in `client/`, read PR feedback in #4–#11.
6. **If resuming gym:** `client/src/features/training-workouts/`, `/api/gym/*`.

**Agent docs:** `AGENTS.md` (UI guide), `AGENT_WORKFLOW.md` (parallel agent rules), `CLAUDE.md` (full reference).
