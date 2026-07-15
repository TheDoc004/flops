# FLOPS — Handoff / Current State

_Last updated: 2026-07-14_

Snapshot of where the app stands so any session (human or Claude) can pick up quickly.
For conventions, architecture, and the phase vision, see `CLAUDE.md` — this file is the
_current-state_ companion to it.

---

## 1. What FLOPS is (one line)

A personal nutrition + training tracker, built toward eventually connecting the two
(the "bridge", Phase 3). Nutrition and Training are developed as **separate domains** —
do not import one domain's business logic into the other.

Phases: **1 Nutrition** (feature-complete), **2 Training** (frontend now built out — see below),
**3 Bridge** (future, not started).

---

## 2. How to run

```bash
# Terminal 1 — API (port 3001)
cd server && npm run dev        # plain `node --watch index.js`; does NOT auto-restart if launched as `node index.js`

# Terminal 2 — client (Vite, port 5173, proxies /api → 3001)
cd client && npm run dev
```

SQLite DB: `server/nutrition.db` (a stale copy at repo root — ignore it). Single user,
`user_id = 0` hardcoded, no auth (intentional). Schema + migrations are inline in
`server/db.js` (`PRAGMA table_info` + conditional `ALTER TABLE`).

> If a running API server predates a schema/route change, **restart it** — a plain
> `node index.js` will not pick up new code or run new migrations on its own.

---

## 3. Current state by area

### Nutrition (Phase 1) — solid / feature-complete
Dashboard, Recipe Library, Ingredient Library (OCR label scan), Meal Builder (wizard +
slots), History, Goals (versioned weekly min/max), Report (PDF), Profile, Adherence, and the
AI Macro Logger all work. Rough edges are **code-size/debt**, not missing features.

### Training (Phase 2) — backend complete; frontend built out this session
Backend was 100% done with client API wrappers already written. As of this session the
frontend covers: workout logging (mobile grid fixed), **weekly Schedule tab**, **post-workout
Feedback card**, **inline progressive-overload sparkline**, and **one-off day Overrides**.
All under `client/src/features/training-workouts/` (new pieces in `components/`).

### Supplements (Nutrition) — shipped this session
Dashboard "Supplements today" checklist; each supplement can optionally **count its
calories/macros toward the day's totals** (per-item flag). Server: `supplements` +
`supplement_log` tables, `routes/supplements.js`. Client: `features/supplements/`.
Profile has a show/hide toggle.

### Cross-cutting foundation — healthy
Mobile nav works (`Navbar` → `BottomNav` switch at 768px, 44px+ targets). Shared UI in
`shared/ui`, hooks in `shared/hooks`, utils in `shared/utils` (well unit-tested). Server routes
are all Jest-tested.

---

## 4. Git state

`main` contains everything below (merged this session, **not pushed** — local `main` is ahead
of `origin/main`):

- `refactor(ai-logger): consolidate ingredient source into one control`
- `feat(training): build out Phase 2 UI (schedule, feedback, overload, overrides)`
- `feat(supplements): daily supplement tracker with optional macro counting`
- + two `--no-ff` merge commits

Merged feature branches still exist locally: `feature/training-phase2-ui`,
`feature/supplement-tracker` (safe to delete). Combined tree builds clean (`npm run build`).

**Deploy:** paused. Only `server/.env.example` exists; no Render/Vercel/Docker config
(the Render+Vercel plan was paused on ~$7/mo persistent-disk cost).

---

## 5. Known issues & tech debt

- **Oversized components** (refactor when next touched): `AiMacroLogger.jsx` (~1,310),
  `TrainingWorkouts.jsx` (~900), `MealBuilder.jsx` (~720), `Ingredients.jsx` (~694),
  `LogMealModal.jsx` (~567). `client/src/hooks/` is empty; extract custom hooks here.
- **Pre-existing lint errors** in `Profile.jsx` (`H3`/`UnitOption` components declared inside
  render — `react-hooks/static-components`). Not from recent work; fix by hoisting them out.
- **No client page-level tests** (Dashboard, Recipes, History, etc.). Utils/server are tested.
- **Test/placeholder recipes** ("c", "c2", "c6") still in the DB — clean before polishing the
  Recipe Library UI.
- Two React pitfalls worth remembering: `{0 && <x>}` renders a stray `0` (use `n > 0 &&`);
  ESLint here enforces `react-hooks/set-state-in-effect` (don't call setState synchronously in
  an effect body).

---

## 6. Parked / deliberately deferred

- **AI Logger — per-unit "1 g" bug**: count foods (egg/slice) occasionally undercount to ~1
  cal when the AI emits `1 g` and the per-unit library match is skipped. Intermittent; needs a
  live repro to decide AI-prompt vs matcher fix.
- **AI Logger — recipe "one-shot" invert**: make the AI estimate the primary result and the
  matched saved recipe a one-tap suggestion (instead of the recipe hijacking the flow).
  Discussed, not built.
- **Training — Daily Training Context UI**: backend exists; fold into a future "Training Today"
  view (low value before the bridge).
- **Nutrition refactors** (the oversized files above) — do opportunistically.

---

## 7. Next planned feature — barcode scanning

Scan a product barcode → save it as an ingredient. Agreed approach (**no MCP, no self-hosted
database**):

1. Read the barcode **in-browser** with the camera (`BarcodeDetector` or `@zxing/browser`),
   same spirit as the existing Tesseract OCR label flow.
2. Barcode number → product + nutrition via **Open Food Facts** (free, no API key). Proxy the
   call through the Express server (avoids CORS, one place to normalize) and save into the
   existing `label_ingredients` table.

Not every product (esp. niche supplements) is in Open Food Facts — keep OCR/manual as
fallback. Camera needs HTTPS in production. Can also pre-fill new supplements.

---

## 8. How work happens here (quick reminders)

- Beginner-friendly: explain non-obvious decisions; prefer the smallest change that works.
- Mobile-first always (test mentally at 390px).
- One topic per commit; don't bundle unrelated changes.
- Feature Brief before building a new feature; verify changes by running the app, not just tests.
