---
tags: [flops, meal-logging, decision]
date: 2026-06-22
commit: 0e95a4c
---

# Flops — "Log once" vs "Save as recipe"

**Commit:** `0e95a4c` — *feat: clear 'Log once' vs 'Save as recipe' distinction* (branch `refactor/folder-structure`)

## What changed
Logging a meal no longer forces it into the Recipe Library. Logging and saving are now separate, explicit actions with plain-language labels.

## Files changed
- `server/routes/log.js` — new `POST /api/log/custom` (logs a one-off meal from absolute macros)
- `client/src/shared/api/log.js` — `createCustomLog()` wrapper
- `client/src/features/meal-logging/LogMealModal.jsx` — new **"Log once (custom)"** mode (paste name + cal/P/C/F)
- `client/src/features/dashboard/Dashboard.jsx` · `features/history/History.jsx` · `features/recipes/Recipes.jsx` — dispatch `log_custom` → `createCustomLog`
- `client/src/features/meal-builder/MealBuilder.jsx` · `RecipeForm.jsx` — replaced "Permanent / Limited-use template" radios with **"Log once"** vs **"Save as recipe"** (consistent across Smart Meal Builder + Manual recipe)

## Why reuse `is_quick_food` instead of changing the schema
`log_entries.recipe_id` is `NOT NULL` (FK → `recipes`), so **every log entry needs a backing recipe row**. The cleaner data model (nullable `recipe_id`) would mean a migration touching the FK and every query that joins `recipes` — higher risk. The existing **quick-food** path already solved "logged but invisible," so I reused that mechanism: no migration, lowest risk.

## How one-time logs stay out of the library
A "Log once" meal writes a backing recipe with **`is_quick_food = 1`**. `GET /api/recipes` (the library list) filters out `is_quick_food`, `is_archived`, and `is_deleted` by default. So one-off meals:
- ✅ appear in the **daily log / history** (via `log_entries`, with macros denormalized onto the row)
- ❌ never appear in the **Recipe Library**

Backing rows are **deduped by name**, so repeats don't pile up. "Save as recipe" still calls `POST /api/recipes` → a normal, visible library recipe.

> Limited-use templates: server logic left intact (existing ones still work); only removed from the creation UI.

## Sets up the AI Macro Logger
The AI Macro Logger should log AI-estimated meals through this **same "Log once" path** (`createCustomLog` → `POST /api/log/custom`). That keeps AI-logged meals in the daily log without polluting the Recipe Library — the exact problem this change fixed. The endpoint already takes plain absolute macros (name + cal/P/C/F[/fiber]), which is the natural shape of an AI estimate.
