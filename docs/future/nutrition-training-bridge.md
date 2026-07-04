# Future: the Nutrition–Training bridge

**Status: archived, not active.** Everything described here was removed from the
active app in July 2026 so Nutrition and Training can be developed as fully
independent domains. The complete working implementation is preserved on the
branch **`archive/nutrition-training-integration`** (branched at commit
`2e969cd`, immediately before the removal commits).

## What was archived, and where it lived

| Piece | Location on the archive branch | What it did |
|---|---|---|
| Training Fuel card | `client/src/features/dashboard/TrainingFuelCard.jsx` | "When should I train after this meal?" — analyzed the most recent logged meal against an activity type + intensity and rendered an ideal training window with reasoning and suggestions |
| Carb-timing engine | `client/src/shared/utils/trainingWindow.js` | ~230 lines: ingredient keyword classification (fast/slow carbs, fiber, fat), meal digestion analysis, and window computation by calorie load and macro profile |
| Readiness scorer | `client/src/features/dashboard/mealTrainingReadiness.js` (+ test) | Scored a meal green/yellow/red across three post-meal windows (15–45, 45–90, 90–180 min) from macros, training context, body weight, and digestion preference |
| Daily context selector | `client/src/features/dashboard/DailyTrainingContextBanner.jsx` | Dashboard dropdown for "what's my training today" (rest → heavy cardio), persisted via `/api/training/daily-context` |
| Readiness card (dead) | `client/src/features/dashboard/MealFuelReadinessCard.jsx` | Traffic-light UI for the scorer; was never wired in |
| Fuel settings page | `client/src/features/training-fuel/Training.jsx` (route `/plan/fuel`) | Digestion preference, training goal, and the saved-fuel-recipes manager |
| Saved fuel shortcuts | Dashboard quick-log buttons + `server/routes/training.js` `/saved-recipes` endpoints | Pinned nutrition recipes as one-tap pre-workout logs (the training→recipes FK coupling) |

## Why it was removed

The product decision (July 2026) is to build Nutrition and Training as two
clearly separated domains that each work fully on their own, and to connect
them later through a deliberate integration layer ("the bridge") once both
sides are solid. The fuel features coupled the nutrition dashboard to training
data (daily context) and training to nutrition internals (recipes, macro
utilities) before the Training side existed properly.

## What's worth revisiting

- **The carb-timing engine** (`trainingWindow.js`) is the most substantial
  piece: deterministic, tested by use, and independent of any UI. It could
  return nearly as-is once real workout sessions exist to anchor it.
- **The readiness scorer's thresholds** (carbs/kg by window and intensity,
  fat/fiber penalties) encode real tuning work — reuse the numbers even if the
  surface changes.
- **Saved fuel shortcuts** were genuinely convenient; rebuilt properly, they
  belong to the bridge's `fueling/` area, driven by the training schedule
  rather than a manual daily-context dropdown.
- **Daily training context** should come from the Training domain's own
  "Today" view (schedule + overrides already exist server-side), not from a
  selector on the nutrition dashboard.

## Prerequisites before rebuilding

1. Training Phase 2b/2c complete: Today view, session logger, and
   `training_feedback` UI producing real structured data.
2. A bridge layer (`bridge/fueling`, per the target architecture) that reads
   from both domains without either importing the other's internals.
3. Real usage data: the readiness heuristics should be validated against
   logged sessions + post-workout feedback, not assumptions.

## What was retained in the active app (marked, unused)

- `training_saved_recipes` table + its data (`server/db.js`) — dropping it
  gains nothing; the FK to recipes is inert without the endpoints.
- `user_profile.dash_training_fuel_enabled`, `digestion_pref`,
  `training_goal` — SQLite DROP COLUMN requires a table rebuild;
  `profile.js` still passes them through harmlessly.
- `daily_training_context` table + `/api/training/daily-context` endpoints —
  training-owned data with no nutrition dependency; the future Training Today
  view is its natural consumer.
- `exercise_library.primary_muscle` / `secondary_muscles` — training metadata
  today, bridge input later.
- The unused pure-training client wrappers in `client/src/shared/api/training.js`
  (schedule, override, today, feedback, daily-context) — reserved for the
  Training UI build-out.

## References

- Archive branch: `archive/nutrition-training-integration` (tip = `2e969cd`)
- Removal commits on `main`: dead code (`a34dd31`), dashboard separation
  (`aa787f7`), fuel page + client API (`10c6143`), server endpoints + schema
  marks (`18a01d8`).
