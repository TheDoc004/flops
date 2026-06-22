# Refactor Progress — COMPLETE

> **Status:** ✅ Done. The `client/src` folder-structure refactor is finished. `pages/`,
> `components/`, and `utils/` are fully dissolved into a feature-based layout.
>
> **Branch:** `refactor/folder-structure` (commits are local only; `main` untouched, nothing pushed).
> **Last updated:** 2026-06-21

---

## Final layout

```
client/src/
  app/          App.jsx (router + MacroUnitsProvider), main.jsx, layouts/PlanLayout.jsx
  styles/       index.css (design-system tokens), App.css
  shared/       api/  utils/  hooks/  context/  ui/   (cross-feature foundation)
  features/
    label-ocr/        cross-cutting: OCR + label parsing + label macros + LabelCropModal
    adherence/        cross-cutting: goal adherence calc, statusMeta, dialog, AdherenceCalendarMonth
    meal-logging/     cross-cutting: LogMealModal, LogEntryRow, quickFoods, recipeLog* utils
    dashboard/        Dashboard + its widgets + fuel-readiness utils
    history/          History
    recipes/          Recipes + RecipeRow
    ingredients/      Ingredients
    meal-builder/     MealBuilder + RecipeForm + IngredientCombobox
    training-fuel/    Training (the /plan/fuel page)
    goals/  profile/  training-workouts/   (migrated earlier)
```

## Conventions (keep following these)
1. Cross-feature imports use aliases: `@app`, `@shared`, `@features`, `@` → `src`. Within a feature, relative `./`.
2. Import a cross-cutting module through its `index.js` barrel, never its internals.
3. A file that is used by more than one feature belongs in `shared/`, not a feature (e.g. `RecipeCombobox`
   → `shared/ui`, `recipeSearch` → `shared/utils`).
4. Each feature folder has an `index.js` barrel; `App.jsx` routes import the feature via `@features/<name>`.

## What was done this pass (oldest → newest commits)
```
label-ocr module → adherence module → meal-logging module
→ shared RecipeCombobox + recipeSearch → AdherenceCalendarMonth into adherence
→ report → recipes → ingredients → meal-builder → training-fuel → history → dashboard
→ app shell (Step 1B) → docs cleanup
```

## Verification notes / environment
- A static import-resolution check (resolves every relative + aliased import across all src files)
  was the per-module gate; all modules passed.
- `npm run build` is the authoritative gate but is **very slow / stalls in this environment** because
  the repo lives under iCloud-synced `~/Documents` (node has to materialize each file on first read).
  Run `npm run build` and `npm test` locally to confirm before merging.
- `npm test` (vitest) cannot spawn workers in the sandbox — environmental, not the refactor.

## Suggested follow-ups (not done)
- Push `refactor/folder-structure` and open a PR after a local `npm run build` + `npm test` pass.
- Consider extracting hooks from the still-large feature pages (MealBuilder, Dashboard, History).
- Move the repo out of iCloud-synced Documents so builds/dev startup are fast and reliable.
