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

## Related

- Receipt logging: `POST /api/log` with `{ recipe_id, ingredients: [...] }`
- AI substitutes: `POST /api/ai/suggest-substitutes`
- Design rule: Log Meal is for *this log*; reshaping a recipe belongs in Meal Builder.
