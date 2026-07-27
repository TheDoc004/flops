# NutriLog — Project Context for Claude

## What This App Is

NutriLog is a personal nutrition + training tracker. The long-term vision is two apps in one:
a **nutritionist** side and a **personal trainer** side that will eventually share data through
a deliberate integration layer (the "bridge") — training history informing nutrition
recommendations, and food logs informing training readiness.

**Current state:** Nutrition and Training are developed as two FULLY SEPARATED domains
(decision: July 2026). Nutrition is feature-complete; Training is being rebuilt (Phase 2).
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

- **Single user only.** `user_id = 0` is hardcoded everywhere. No auth exists. Do not add auth.
- **SQLite is synchronous.** `better-sqlite3` uses sync calls — no `.then()` on DB queries.
- **Soft deletes.** Recipes use `is_deleted = 1`. Workout presets use `is_deleted = 1`. Never hard-delete things that log entries reference.
- **Schema migrations** are inline in `server/db.js` using `PRAGMA table_info()` + conditional `ALTER TABLE`. Follow this pattern when adding columns to existing tables.
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
│   │   ├── utils/            # pure JS utilities (no side effects)
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
| `/` | Dashboard | Today's log, macro totals, weight, adherence (pure nutrition) |
| `/recipes` | Recipe Library | Browse, archive, delete |
| `/ingredients` | Ingredient Library | Label ingredients for Meal Builder |
| `/meal-builder` | Meal Builder | OCR label scan → recipe builder |
| `/history` | History | Charts, past day drill-down, edit entries |
| `/training` | TrainingWorkouts | Workout presets, logging, progress (being rebuilt) |
| `/plan` | Plan shell | Sub-nav for Goals / Report / Profile |
| `/plan/goals` | Goals | Weekly macro targets with min/max ranges |
| `/plan/report` | Report | PDF export of intake for a date range |
| `/plan/profile` | Profile | Physical stats, unit prefs, dashboard toggles |

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
`recipes` — `id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients (JSON), recipe_kind (permanent|limited), remaining_uses, max_uses, is_archived, meal_builder_meta (JSON), is_quick_food, is_deleted`

### Log
`log_entries` — `id, recipe_id, date, time_min, servings, notes, slot_selections_json, recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food`

### Goals
`day_goal_versions` — `user_id, effective_start_date, weekday, calories_min, calories_max, protein_g_min, protein_g_max, carbs_g_min, carbs_g_max, fat_g_min, fat_g_max, created_at`

### Profile
`user_profile` — `user_id, height_cm, weight_kg, age, sex, goal_weight_kg, activity_level, maintenance_calories, macro_units, body_units, dash_weight_chart_enabled, dash_weight_days` — plus three RETAINED-UNUSED columns from the archived fuel features (`dash_training_fuel_enabled, digestion_pref, training_goal`); nothing reads or writes them from the UI
`body_weights` — `user_id, date, weight_kg`

### Ingredients
`label_ingredients` — `id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri, source_type (manual|scanned_label|built_in|barcode), use_count, last_used_at, barcode`

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

## Training Section — Build Status (Phase 2)

Phase 2a (complete): exercise_library table + seeding, preset_id on training_schedule,
exercise_library_id on workout_preset_exercises, exercise library API endpoint, schedule and
today endpoints updated to carry preset linkage.

Phase 2b (next): Today view + weekly schedule UI with preset linking. Distinct visual treatment
for Training section.

Phase 2c (planned): Active workout logger (set-by-set, previous session reference), post-workout
feedback UI, progress view as standalone tab.

Phase 3 (future): Cross-app intelligence via a dedicated bridge layer — training muscle group
data informs nutrition protein timing / recovery recommendations. exercise_library.primary_muscle
and secondary_muscles are the bridge columns. The earlier fuel/readiness implementation is
preserved on `archive/nutrition-training-integration`; see
`docs/future/nutrition-training-bridge.md` for what exists and the prerequisites for rebuilding.
Do not build bridge features until both domains are solid, and never by importing one domain's
internals into the other.

## Important Notes for Future Sessions

- The `training_schedule.workout_type` free-text field predates the exercise library. It still exists but `preset_id` is the canonical link going forward.
- `training_feedback` (energy/stomach/performance) has a complete backend + client API but no UI yet.
- `fetchTrainingSchedule()` and `saveTrainingSchedule()` in `client/src/api/training.js` are implemented but not yet called from any page.
- The two-column grid layout in `TrainingWorkouts.jsx` breaks on mobile — the page redesign in Phase 2b will replace it entirely.
- Do not add a CSS framework. Push the existing plain CSS system harder instead.
- Recharts charts must always be wrapped in `<ResponsiveContainer width="100%" height={N}>`.
