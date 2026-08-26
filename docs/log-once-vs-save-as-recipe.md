---
tags: [flops, meal-logging, decision]
date: 2026-08-17
---

# Flops — "Log once" vs "Save as recipe" (and Log Meal receipts)

## Current model (2026-08-17)

**Log Meal** builds a freeform **receipt** of Ingredient Library rows (amounts + live macros).
A saved **recipe** is a named ingredient list that can **seed** that receipt; logging never
rewrites the recipe. The log keeps `recipe_id` for History naming and stores the final receipt
in `log_entries.ingredients_json`.

**Meal Builder → Save as recipe** writes `kind: 'ingredient'` lines (library id + amount/unit).
Substitutes are suggested at log time (AI / heuristic), not authored onto the recipe.

**Log once** (Meal Builder review, AI Macro Logger, receipt without keeping a recipe seed) still
uses `POST /api/log/custom` and a hidden `is_quick_food` backing recipe so one-offs stay out of
the Recipe Library.

## Why `is_quick_food` (unchanged)

`log_entries.recipe_id` is `NOT NULL`, so every entry needs a backing recipe row. Quick-food
rows are filtered out of `GET /api/recipes` by default.

## Update 2026-08-25 — capturing a recipe from a receipt

The receipt model left no way to keep a meal you had just worked out: tweaking amounts and
wanting to hold on to the version that worked meant rebuilding it in the Meal Builder. Two
entry points now capture one:

| Where | What it saves |
|---|---|
| **Save as Recipe** under `Log Meal` (`LogMealModal`) | The assembled receipt, without logging it |
| **Save as Recipe** in a logged meal's `⋯` menu (`LogEntryRow` → `SaveMealAsRecipeDialog`) | That meal, name prefilled |

Both go through `buildRecipeFromReceipt` / `buildRecipeFromLogEntry` in `recipeReceipt.js` and
emit `kind: 'ingredient'` lines carrying `label_ingredient_id`, so a captured recipe is as
editable in the Meal Builder as one authored there. Rows with no library link survive as
free-text `kind: 'line'` so nothing silently drops out of the total. Lines keep the unit they
were measured in — a receipt built in ml saves as ml.

Logged entries store ingredient rows **per serving**, which is the basis a recipe wants, so
the servings count is deliberately not applied: saving a two-serving log yields a recipe for one.

**The design rule is narrowed, not dropped.** Log Meal still does not *reshape* a recipe —
logging a modified meal never rewrites the recipe it was seeded from. What is now allowed is
*capturing* the current receipt as a NEW recipe. Editing an existing one still belongs in the
Meal Builder.

## Related

- Receipt logging: `POST /api/log` with `{ recipe_id, ingredients: [...] }`
- Capturing a recipe: `POST /api/recipes` with `kind: 'ingredient'` lines
- AI substitutes: `POST /api/ai/suggest-substitutes`
- Design rule: Log Meal is for *this log* — it may capture a new recipe, but reshaping an
  existing recipe belongs in Meal Builder.
