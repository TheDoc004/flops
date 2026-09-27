# FLOPS — Handoff / Current State

_Last updated: 2026-09-27 (`get_server_info` / deploy identity)_

> **▶ Product north star:** FLOPS is a **notebook** — see **`docs/philosophy-notebook.md`**.
> Viewing day does not auto-flip at midnight; coach tools are read + summarize.
>
> **Auth / onboarding / coach** are live: Bearer sessions (email OTP + Apple/dev),
> first-run onboarding, invite codes, consent scopes, Coach roster + soft suggestions.
>
> **Deploy:** **LIVE** — see [Deploy (live)](#deploy-live) below and **`docs/deploy-checklist.md`**.

Snapshot of where the app stands so any session (human or agent) can pick up quickly.
For conventions, architecture, and the phase vision, see **`CLAUDE.md`** — this file is the
_current-state_ companion to it.

> **⚠️ Canonical repo:** **`~/dev/FLOPS`**. Do **not** work from
> `~/Documents/FLOPS workspace/` — that folder is stale / iCloud-adjacent and may
> not match what is deployed. Start sessions from `~/dev/FLOPS`.

---

## Where Diego left off (read this first)

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

**Last active work stream:** `get_server_info` MCP tool + `/health` identity
(`git_sha`, `built_at`, `process_started_at`, `tool_count`) so a deploy can be
verified without failing a write — see `docs/mcp-connector.md`.

**When you return / next picks (optional):**

1. **Backfill** — use `update_food_item` + `micros_per_100g` + `micros_confidence` (`medium` for USDA, `high` for labels); past meals pick them up live.
2. **Claude connector** — after Render redeploy, call `get_server_info` (or `curl /health`) and confirm `git_sha` matches the merged commit; refresh the connector if `tool_count` looks stale client-side.
3. **Gym UX / progressive overload** — agent can already call `get_gym_progress`.
4. **Dashboard layout editor polish** — see [§ Dashboard layout editor](#dashboard-layout-editor--last-touched-aug-2026).
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

Phases: **1 Nutrition** (feature-complete for Diego's daily use), **2 Training** (gym dashboard),
**3 Bridge** (future, not started).

---

## 2. How to run

Repo root: **`~/dev/FLOPS`**. One-shot: `bash ~/dev/FLOPS/start-app.sh`. Or two terminals:

```bash
cd ~/dev/FLOPS

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

**Customize layout:** Profile → customize dashboard, or `/?editLayout=1`. See layout editor section below.

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

### Dashboard layout editor — last touched Aug 2026

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

**Known rough edges (parked — Diego's feedback):**

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

Design canvases: contrast matrix <https://claude.ai/code/artifact/44f32c62-04be-4da5-bcf5-e163a2db33e2>,
app review, all 14 routes + 5 chrome surfaces <https://claude.ai/code/artifact/dab937c0-3480-4304-87e9-12bb6068810a>.
Working files in `.design/` (`gen.py` regenerates the artboards). **Note both canvases predate
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
for live deploy (Diego's workflow — see `.cursor/rules/early-ship-and-feature-commits.mdc`).

---

## 5. Known issues & tech debt

**Not blocking daily use:**

- **Dashboard layout editor UX** — functional but not polished to Diego's ideal; **parked**.
- **Email OTP / Resend** — production codes fail until Resend sending domain verified on Render.
- **Oversized components:** `AiMacroLogger.jsx`, `Ingredients.jsx`, `MealBuilder.jsx`, `LogMealModal.jsx`.
- **AiMacroLogger** hardcoded light-theme inline colors in review panels (notebook-day risk).
- **Stale brand asset:** `flops-badge.png` (2MB amber lightbulb) clashes with navy/paper identity.
- **No in-app data export** — SQLite on Render disk; `scripts/backup-sqlite.sh`.
- **Meal Builder browser history** — mode/step pushes history entries (`{ replace: true }` fix deferred).

**Tests (Aug 2026):** server ~301 Jest; client ~366 Vitest unit. Playwright e2e specs live under
`client/e2e/` and run via `npm run verify:layout-editor`, not `npm test`.

---

## 6. Parked / deliberately deferred

- **Dashboard layout editor visual polish** — Diego paused here; app is usable without it.
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
- **Do not put the repo back in iCloud-synced `~/Documents`.** Start from **`~/dev/FLOPS`**.
- **HANDOFF.md is enforced** — `.claude/hooks/check-handoff.sh` blocks Stop if source changed without updating this file.
- For UI/theming: **`docs/design-system.md`** + notebook-day section above.
- Auto-ship: push `main` after shippable work unless Diego says "don't push".

---

## 8. Picking up after the pause

1. `cd ~/dev/FLOPS && git pull origin main`
2. Read this file + skim **`CLAUDE.md`** for architecture.
3. `cd server && npm run dev` + `cd client && npm run dev` (or `start-app.sh`).
4. Log in at [useflops.com](https://www.useflops.com) — app should match `main`.
5. **If resuming layout editor:** start with `client/src/features/dashboard/`, run
   `npm run verify:layout-editor` in `client/`, read Diego's feedback in PRs #4–#11.
6. **If resuming gym:** `client/src/features/training-workouts/`, `/api/gym/*`.

**Agent docs:** `AGENTS.md` (UI guide), `AGENT_WORKFLOW.md` (parallel agent rules), `CLAUDE.md` (full reference).
