# FLOPS — Project Context for Claude / Claude Code

> **Current state snapshot:** see **`HANDOFF.md`** (updated each session). Canonical repo: **`~/dev/FLOPS`**. Live: **https://www.useflops.com** (Vercel + Render, push `main` to deploy).

## What This App Is

NutriLog is a personal nutrition + training tracker. The long-term vision is two apps in one:
a **nutritionist** side and a **personal trainer** side that will eventually share data through
a deliberate integration layer (the "bridge") — training history informing nutrition
recommendations, and food logs informing training readiness.

**Current state:** Nutrition and Training are developed as two FULLY SEPARATED domains
(decision: July 2026). Nutrition is feature-complete. Training is a **gym dashboard** at
`/training` with its own nav chrome (Today / Schedule / Workouts / Progress) and `/api/gym`
backend — rebuilt Aug 2026 as a set-by-set logger (templates, schedule, progress, 1RM).
The earlier cross-domain fuel/readiness features were removed from the active app and are
preserved on the branch `archive/nutrition-training-integration` — see
`docs/future/nutrition-training-bridge.md`. Do not add new cross-domain features:
Nutrition must not import Training business logic and vice versa. The bridge is Phase 3,
built only after both domains work well independently.

## Running the App

```bash
# Terminal 1 — API server (port 3001)
cd server && npm run dev

# Terminal 2 — Vite dev server (port 5173)
cd client && npm run dev
```

Vite proxies `/api` → `localhost:3001` in dev. The SQLite DB lives at
`server/nutrition.db`. There is also a stale `nutrition.db` at the root — ignore it.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, React Router 7, Vite 5 |
| Charts | Recharts 3 (always wrap in `<ResponsiveContainer>`) |
| OCR | Tesseract.js 7 (runs in-browser, no server involvement) |
| Barcodes | Native `BarcodeDetector` where available, `@zxing/browser` lazy-loaded as fallback (iPhone Safari has no native API) |
| PDF export | jsPDF 4 + jsPDF-autotable 5 |
| Backend | Node.js + Express 4 |
| Database | SQLite via `better-sqlite3` (synchronous, no async/await on DB calls) |
| Testing | Jest + Supertest (server), Vitest + Testing Library (client) |
| Styling | Plain CSS + inline styles — **no CSS framework** |

## Critical Conventions

- **Notebook philosophy.** FLOPS is a notebook — see `docs/philosophy-notebook.md`. Do not
  auto-advance the viewing day, nag, or invent work the user did not ask for. AI is opt-in.
- **Notebook-day theming (Dashboard only).** When viewing a non-today date on `/`,
  `Dashboard.jsx` sets `html[data-notebook-day="past"|"future"]`. Tokens in `index.css`
  invert to charcoal + light type. Native `<dialog>` elements do **not** inherit this unless
  explicitly styled — modals need `html[data-notebook-day] dialog { … }` rules. Button variants
  `.btn-primary` / `.btn-ai` need notebook-day overrides (sky-blue `--color-primary` fails on
  charcoal). Prefer CSS variables over hardcoded `#f9fafb` / `#eff6ff` in modal JSX. See
  `HANDOFF.md` § Notebook-day UI.
- **Multi-user with auth.** Each request resolves `req.user.id`. Legacy local data was migrated
  onto the first account. Isolation tests must keep user A off user B’s rows. Rate limiting and
  `ai_usage` caps protect paid AI routes — see `docs/future/deployment-and-mcp.md`.
- **SQLite is synchronous.** `better-sqlite3` uses sync calls — no `.then()` on DB queries.
- **Soft deletes.** Recipes use `is_deleted = 1`. Workout presets use `is_deleted = 1`. Never hard-delete things that log entries reference.
- **Schema migrations** are inline in `server/db.js` using `PRAGMA table_info()` + conditional `ALTER TABLE`. Follow this pattern when adding columns to existing tables.
- **Unit conversion lives in one place.** `client/src/shared/utils/unitConvert.js` and its
  CommonJS twin `server/unitConvert.js` decide what a unit means. Units belong to three
  families (mass / volume / count); within a family conversion is exact, and the only bridge
  across them is `grams_per_unit` — the weight of one serving unit. Because that bridge is a
  weight it only spans mass, so a grams-per-serving ingredient can never take a volume.
  Every scaling path goes through `amountInBasisUnit` (via `servingsForAmount` on the client,
  `servingsForIngredientAmount` on the server) rather than reading the unit itself.
  - **The two files must stay identical in body** — `server/__tests__/unitConvert.test.js` has
    a parity test that fails if they drift. Change both together.
  - **`null` means refuse to scale, never zero.** These functions return null when a conversion
    is not knowable; callers must surface an error rather than guess. Guessing is what let
    "2 slices" silently scale a per-filet ingredient.
- **`tracking_type` is derived, not defaulted.** `resolveTrackingType()` in
  `routes/labelIngredients.js` infers it when a client omits it — grams present means `weight`,
  a unit-shaped serving without grams means `unit`. Defaulting to `weight` produced rows that
  carried macros but could never be logged; `repairHybridIngredientTracking()` in `db.js` heals
  those at boot. Watch for rows whose `tracking_type` disagrees with which of
  `grams_per_serving` / `unit_name`+`serving_quantity` is populated.
- **Log entry denormalization.** When a meal is logged, recipe macros are copied into `log_entries` columns (`recipe_calories`, `recipe_protein_g`, etc.) so historical records survive recipe edits.
- **No CSS framework.** Use the existing `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.error`, `.empty-state` classes from `client/src/styles/index.css`. Extend with inline styles.
- **MacroUnitsContext** is the only React Context — it exposes `macroUnits` ('metric'|'us') and `bodyUnits` ('metric'|'us') from the user profile. Consume it in any component that displays macro values or weights.

## Folder Structure

```
nutrition-tracker/
├── server/
│   ├── index.js              # Express entry, CORS, route mounting
│   ├── db.js                 # SQLite schema + all migrations inline
│   ├── recipeIngredients.js  # Variable slot logic for recipe ingredients
│   └── routes/
│       ├── recipes.js        # Recipes CRUD (permanent + limited-use)
│       ├── log.js            # Meal log (daily entries, quick-food, range queries)
│       ├── goals.js          # Versioned weekly macro goals (min/max ranges)
│       ├── profile.js        # User profile + body weight log
│       ├── training.js       # Training schedule, overrides, daily context, feedback
│       ├── workouts.js       # Workout presets, exercise library, exercise logs, progress
│       └── labelIngredients.js # Ingredient library CRUD + OCR use tracking
│
├── client/src/               # feature-based layout
│   ├── app/                  # App.jsx (router + MacroUnitsProvider), main.jsx, layouts/PlanLayout.jsx
│   ├── styles/               # index.css (design-system tokens), App.css
│   ├── shared/               # cross-feature foundation
│   │   ├── api/              # thin fetch wrappers, one file per route group
│   │   ├── utils/            # pure JS utilities (no side effects). unitConvert.js is
│   │   │                     # twinned with server/unitConvert.js — change both
│   │   ├── hooks/            # custom hooks (useMediaQuery, usePaginationAnchor, useDropdownPlacement)
│   │   ├── context/          # MacroUnitsContext
│   │   └── ui/               # shared UI (Navbar, BottomNav, MacroTotals, RangeSelector, RecipeCombobox)
│   └── features/<name>/      # one folder per feature: <Page>.jsx + index.js barrel + colocated
│                             # components/utils. Cross-cutting modules also live here
│                             # (label-ocr, adherence, meal-logging).
```

**Import conventions:** cross-feature imports use path aliases (`@app`, `@shared`, `@features`,
and `@` → `src`); within a feature use relative paths. Import a cross-cutting module through its
`index.js` barrel, never its internals.

## Route Map

| URL | Page | Notes |
|---|---|---|
| `/` | Dashboard | Today's log, macro totals, weight, supplements. Daily actions only — charts and adherence live in Review |
| `/recipes` | Recipe Library | Browse, expand to macros/micros/ingredients, archive, delete |
| `/ingredients` | Ingredient Library | Label ingredients (OCR + barcode); also logged directly as one-off foods |
| `/meal-builder` | Meal Builder | The recipe EDITOR. Reached from the Recipes & Ingredients section, not from logging |
| `/history` | History ("Review") | Charts, weight trend, micronutrients, adherence, past-day drill-down |
| `/training` | GymToday | Live session logger (default gym tab) |
| `/training/schedule` | GymSchedule | Weekly template assignments |
| `/training/workouts` | GymWorkouts | Template builder, exercise library |
| `/training/progress` | GymProgress | Charts, 1RM, filters |
| `/plan` | Plan shell | Sub-nav for Goals / Report / Profile |
| `/plan/goals` | Goals | Weekly macro targets with min/max ranges |
| `/plan/report` | Report | PDF export of intake for a date range |
| `/plan/profile` | Profile | Physical stats, unit prefs, dashboard toggles |

**Navigation shape.** Every top-level nav item is a **direct link** — there are no dropdowns
(desktop `Navbar`) and no bottom sheets (mobile `BottomNav`); both were removed once their groups
were down to one or two destinations. `/recipes`, `/ingredients` and `/meal-builder` are one
section, "Recipes & Ingredients": the nav points at `/recipes` and stays lit across all three, and
`LibrarySubNav` carries the crossing between the two library pages plus the `+ Build a meal`
button. **Logging starts on Today**, whose header holds both entry points — there is no "Log" nav
group.

## API Endpoints

### Recipes
- `GET /api/recipes` — list (filters: include_archived, include_quick, include_deleted)
- `GET /api/recipes/:id`
- `POST /api/recipes` — create
- `PUT /api/recipes/:id` — update
- `POST /api/recipes/:id/reactivate` — bump uses on limited-use template
- `DELETE /api/recipes/:id` — soft delete (sets is_deleted=1)

### Meal Log
- `GET /api/log?date=YYYY-MM-DD` or `?start=&end=`
- `GET /api/log/days` — paginated daily summaries
- `POST /api/log` — log a recipe
- `POST /api/log/quick-food` — log a food by weight + macros/100g (no recipe needed)
- `PUT /api/log/:id` — edit entry
- `DELETE /api/log/:id`

### Goals
- `GET /api/goals?date=YYYY-MM-DD` — returns versioned goals resolved for that date
- `PUT /api/goals` — upsert a goal version (body: `{effective_start_date, goals:[]}`)

### Profile
- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/body-weights?start=&end=`
- `PUT /api/body-weights` — upsert a day's weight
- `DELETE /api/body-weights/:date`

### Training
- `GET /api/training/schedule` — full 7-day recurring schedule
- `PUT /api/training/schedule` — upsert all 7 days (each row has preset_id)
- `GET /api/training/today?date=&weekday=` — resolves override → schedule → none
- `GET /api/training/override?date=`
- `PUT /api/training/override`
- `DELETE /api/training/override/:date`
- `GET /api/training/daily-context?date=` — rest|light_cardio|medium|heavy_lifting|heavy_cardio (no client consumer yet; future Training Today view)
- `PUT /api/training/daily-context`
- `GET /api/training/feedback?date=`
- `PUT /api/training/feedback`

### Workouts
- `GET /api/workouts/exercise-library` — structured exercise catalog (muscle groups, movement type, equipment)
- `GET /api/workouts/presets` — list user's workout presets
- `POST /api/workouts/presets`
- `PUT /api/workouts/presets/:id`
- `DELETE /api/workouts/presets/:id` — soft delete
- `GET /api/workouts/presets/:id/exercises` — ordered exercise list
- `POST /api/workouts/presets/:id/exercises`
- `DELETE /api/workouts/exercises/:id`
- `GET /api/workouts/today?date=` — which preset was selected for a date
- `PUT /api/workouts/today` — set today's preset
- `POST /api/workouts/logs` — log a single exercise (weight/reps/sets)
- `GET /api/workouts/progress?exercise_name=` — historical logs for an exercise

### Micronutrient key set (v2, 2026-07-30)
28 canonical keys — vitamins incl. the B-complex and E/K, minerals incl. selenium/copper/manganese/phosphorus/iodine, omega-3s (ALA/EPA/DHA), fiber, choline. Single source of truth: `client/src/shared/config/microNutrients.js`, mirrored in `server/microNutrients.js` (keys encode units: `_g`/`_mg`/`_mcg`). AI prompt schemas are GENERATED from `MICRO_KEYS`, so adding a key automatically reaches estimation, label scan, and name-estimate prompts — but DSLD `GROUP_TO_KEY` and OFF `MICRO_SOURCES` must be taught new names by hand. DSLD label parsing walks `nestedRows` (fish-oil labels bury EPA/DHA under Total Fat). v1 blobs simply carry fewer keys; expansion is additive.

### Supplements (dose model)
`supplements` stores macros/micros **per label serving** — that is what every capture path reports. `label_serving_qty` + `label_serving_unit` describe that serving; `dose_qty` is how much you actually take. `supplement_log.dose_qty` overrides it for one date (NULL = your usual dose). `server/supplementDose.js` owns the parsing and the multiplier (`dose_qty / label_serving_qty`, guarded against 0/NaN); the route returns values **already scaled**, with untouched label values under `per_label_serving`. Never sum a supplement's stored columns directly — that reads the label's serving, not the intake.

### Supplements (lookup)
- `GET /api/supplements/search?q=` — search the NIH Dietary Supplement Label Database (DSLD) by product/brand name. Free, no API key. Off-market products rank last.
- `GET /api/supplements/dsld/:id` — one matched label, shaped exactly like `scan-label` (`{name, dose_text, macros, micros, confidence, notes}`) so all prefill paths share client code. Label-exact → `high` confidence.
- `POST /api/supplements/estimate` — AI estimate from a product name, for what DSLD lacks. Capped at `medium` confidence in both the service and the route; never `high`.
- Storing micros accepts optional `micros_confidence` / `micros_source`; anything but `medium`/`low` falls back to label confidence.

### Barcode
- `GET /api/barcode/:code` — proxies Open Food Facts (free, no API key) and normalizes the product into ingredient-form fields. Returns `basis` (`serving` | `serving_derived` | `100g` | `none`) so the UI can say where the numbers came from, plus `existing_ingredient` when that barcode is already saved. 404 = not on record, 502 = database unreachable.

### Label Ingredients
- `GET /api/label-ingredients`
- `GET /api/label-ingredients/:id`
- `POST /api/label-ingredients`
- `PUT /api/label-ingredients/:id`
- `POST /api/label-ingredients/used` — increment use_count
- `DELETE /api/label-ingredients/:id`

## Database Schema (Key Tables)

### Recipes
`recipes` — `id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients (JSON), recipe_kind (permanent|limited), remaining_uses, max_uses, is_archived, meal_builder_meta (JSON), is_quick_food, is_deleted, micros_json, micros_fingerprint`

`micros_json` / `micros_fingerprint` cache the micro estimate for the recipe's DEFAULT ingredients so browsing the library doesn't pay for an AI call per expand; the fingerprint is hashed from the ingredients it was computed from, so an edit invalidates it.

### Log
`log_entries` — `id, recipe_id, date, time_min, servings, notes, slot_selections_json, recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, ingredients_json, micros_json`

### Goals
`day_goal_versions` — `user_id, effective_start_date, weekday, calories_min, calories_max, protein_g_min, protein_g_max, carbs_g_min, carbs_g_max, fat_g_min, fat_g_max, created_at`

### Profile
`user_profile` — `user_id, height_cm, weight_kg, age, sex, goal_weight_kg, activity_level, maintenance_calories, macro_units, body_units, dash_weight_chart_enabled, dash_weight_days` — plus three RETAINED-UNUSED columns from the archived fuel features (`dash_training_fuel_enabled, digestion_pref, training_goal`); nothing reads or writes them from the UI
`body_weights` — `user_id, date, weight_kg`

### Ingredients
`label_ingredients` — `id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri, source_type (manual|scanned_label|built_in|barcode), use_count, last_used_at, barcode, micros_json`

**Micronutrient precedence (log time).** `server/labelMicros.js` sums micros from logged rows whose `label_ingredient_id` has a stored `micros_json` (captured on barcode import, per serving), scaled by the amount logged. The AI estimator is asked only about the remaining rows, and results merge **per nutrient** — a measured value always beats an estimate. All rows covered → no AI call and `high` confidence; a partial mix stores `medium`.

### Training / Workouts
`exercise_library` — `id, name, primary_muscle, secondary_muscles (JSON array), movement_type (push|pull|legs|core|cardio), equipment (barbell|dumbbell|cable|bodyweight|machine)` — seeded with ~54 common exercises; not user-editable yet

`workout_presets` — `id, user_id, name, intensity_label, notes, is_deleted`
`workout_preset_exercises` — `id, user_id, preset_id, name, sort_order, exercise_library_id (nullable FK → exercise_library)`
`workout_day_selections` — `user_id, date, preset_id, preset_name` — manual override: which preset was chosen for a specific calendar date
`exercise_logs` — `id, user_id, date, preset_id, preset_name, exercise_name, weight, weight_unit, reps, sets, created_at`

`training_schedule` — `user_id, weekday (1-7), enabled, time_min, workout_type, duration_min, preset_id (FK → workout_presets)` — recurring weekly plan; preset_id links a day to a specific workout preset
`training_overrides` — `user_id, date, enabled, time_min, workout_type, duration_min` — one-off date override to recurring schedule
`daily_training_context` — `user_id, date, context_type (rest|light_cardio|medium|heavy_lifting|heavy_cardio)` — training-owned; no client consumer since the fuel-card removal (future Training Today view)
`training_feedback` — `user_id, date, energy, stomach, performance, notes` — post-workout self-assessment
`training_saved_recipes` — `user_id, recipe_id, label` — RETAINED-UNUSED (endpoints removed with the nutrition-training separation; data kept)

## Recipe Ingredient Slots (Advanced)

Recipes built via Meal Builder have a variable slot system. Each ingredient in a recipe can be a
`slot` with multiple `option_label_ingredient_ids`. At log time the user can swap the default
ingredient for any option. This is handled by `server/recipeIngredients.js` and the
`slot_selections_json` column on `log_entries`.

## Training / Gym (Phase 2) — current architecture

**UI:** `client/src/features/training-workouts/` — `GymApp.jsx`, pages under `pages/`,
`TrainingLayout.jsx` (Nutrition hop). Gym tabs in `Navbar` / `BottomNav` when on `/training/*`.

**API:** `server/routes/gym.js` — exercises, templates, sessions, sets, schedule, progress,
1RM helpers, duration activity sessions. Client wrappers in `client/src/shared/api/gym.js` (if present).

**Legacy:** `server/routes/training.js` and `workouts.js` remain from the old preset logger;
new gym UI uses **`gym.js`**. Do not wire nutrition to training data yet (Phase 3).

Phase 3 (future): Cross-app intelligence via a dedicated bridge layer. See
`docs/future/nutrition-training-bridge.md`. Never import one domain's internals into the other.

## Important Notes for Future Sessions

- **Deploy:** push to `main` → Vercel production. API on Render (`docs/deploy-checklist.md`).
- **HANDOFF.md** is the living current-state doc; update it when finishing a session with meaningful changes.
- Do not add a CSS framework. Push the existing plain CSS system harder instead.
- Recharts charts must always be wrapped in `<ResponsiveContainer width="100%" height={N}>`.
- When styling modals or off-today Dashboard, test **past day + Log Meal + AI Estimate** — common contrast trap.
