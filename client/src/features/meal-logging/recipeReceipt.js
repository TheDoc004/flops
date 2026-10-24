/**
 * Recipe → Log Meal receipt helpers.
 * Recipes are named ingredient lists that seed an editable receipt.
 */

import { macrosForLabelServingAmount } from '@features/label-ocr';
import { convertForIngredient, loggableUnitsFor, roundAmount, canonicalUnit } from '@shared/utils/unitConvert';
import { formatAmountWithUnit } from '@shared/utils/servingBasis';
import { parseLoggedIngredients } from '@shared/utils/macros';

function tryParseLineAmount(lineItem) {
  const s = String(lineItem?.amount ?? '').trim();
  const m = /^([\d.]+)\s*(g|oz)?\s*$/i.exec(s.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || 'g').toLowerCase();
  return { amount: String(n), unit: u === 'oz' ? 'oz' : 'g' };
}

/**
 * Normalize a stored unit for persistence. Measurement units fold to their
 * canonical spelling ("Ounces" -> "oz", "fl. oz." -> "fl oz"); count units keep
 * their own name. An absent unit means grams, as it always has.
 */
export function persistAmountUnit(unit) {
  return canonicalUnit(unit) || 'g';
}

/**
 * Library-backed lines from a recipe (migrates legacy slots / meta lines).
 * @returns {Array<{ label_ingredient_id: number, name: string, amount: string, unit: string }>}
 */
export function listRecipeIngredientLines(recipe) {
  if (!recipe) return [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const meta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object' ? recipe.meal_builder_meta : null;
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const out = [];

  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item) continue;

    if (item.kind === 'ingredient' && item.label_ingredient_id != null) {
      const lid = Number(item.label_ingredient_id);
      if (!Number.isInteger(lid) || lid <= 0) continue;
      const amount = String(item.amount ?? '').trim();
      if (!amount) continue;
      out.push({
        label_ingredient_id: lid,
        name: String(item.name || '').trim() || `Ingredient #${lid}`,
        amount,
        unit: persistAmountUnit(item.unit),
      });
      continue;
    }

    if (item.kind === 'slot') {
      const ids = Array.isArray(item.option_label_ingredient_ids)
        ? item.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
        : [];
      const lid = ids[0];
      if (!lid) continue;
      const amount = String(item.amount ?? '').trim();
      if (!amount) continue;
      out.push({
        label_ingredient_id: lid,
        name: String(item.label || '').trim() || `Ingredient #${lid}`,
        amount,
        unit: persistAmountUnit(item.unit),
      });
      continue;
    }

    if (item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (!ml || ml.label_ingredient_id == null) continue;
    const lid = Number(ml.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) continue;
    let amountStr = ml.amount != null && String(ml.amount).trim() !== '' ? String(ml.amount).trim() : '';
    let unit = persistAmountUnit(ml.unit);
    if (!amountStr || Number(amountStr) <= 0) {
      const fb = tryParseLineAmount(item);
      if (fb) {
        amountStr = fb.amount;
        unit = fb.unit;
      }
    }
    if (!amountStr || Number(amountStr) <= 0) continue;
    out.push({
      label_ingredient_id: lid,
      name: String(item.name || ml.name || '').trim() || `Ingredient #${lid}`,
      amount: amountStr,
      unit,
    });
  }
  return out;
}

/**
 * Free-text recipe lines with no library link (manual notes only).
 */
export function listNonEditableTemplateLines(recipe) {
  if (!recipe) return [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const meta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object' ? recipe.meal_builder_meta : null;
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const lines = [];
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item || item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (ml && ml.label_ingredient_id != null) continue;
    lines.push(item);
  }
  return lines;
}

export function newReceiptLineId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `rl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default amount/unit when adding a library ingredient to the receipt. */
export function defaultAmountForIngredient(ing) {
  if (!ing) return { amount: '', unit: 'g' };
  if (ing.tracking_type === 'unit') {
    return {
      amount: String(ing.serving_quantity ?? 1),
      unit: String(ing.unit_name || 'unit'),
    };
  }
  const gps = Number(ing.grams_per_serving);
  return {
    amount: Number.isFinite(gps) && gps > 0 ? String(gps) : '',
    unit: 'g',
  };
}

/**
 * Build a live receipt line from a library ingredient + amount.
 * @returns {object|null}
 */
export function buildReceiptLine(ing, amount, unit, { id, source = 'library', suggested_amount } = {}) {
  if (!ing) return null;
  const amt = amount != null ? String(amount) : '';
  // Always canonical, so the unit a line is computed in is the unit the picker
  // shows as selected — "Cups" and "cup" must not be two different things.
  const u = canonicalUnit(unit) || 'g';
  const macros = macrosForLabelServingAmount(ing, amt, u);
  if (!macros) return null;
  const line = {
    id: id || newReceiptLineId(),
    label_ingredient_id: Number(ing.id),
    name: ing.name,
    brand_name: ing.brand_name || null,
    amount: amt,
    unit: u,
    tracking_type: ing.tracking_type || 'weight',
    unit_name: ing.unit_name || null,
    calories: macros.calories,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    fiber_g: macros.fiber_g,
    source,
  };
  if (suggested_amount != null && String(suggested_amount).trim() !== '') {
    line.suggested_amount = String(suggested_amount);
  }
  return line;
}

/**
 * Library add with empty amount + gray placeholder suggestion.
 * Macros preview uses the suggested serving until the user commits.
 * @returns {object|null}
 */
export function buildGhostReceiptLine(ing, { id, source = 'library' } = {}) {
  if (!ing) return null;
  if (loggableUnitsFor(ing).length === 0) return null;
  const def = defaultAmountForIngredient(ing);
  if (!def.amount || !String(def.amount).trim()) return null;
  const full = buildReceiptLine(ing, def.amount, def.unit, {
    id,
    source,
    suggested_amount: def.amount,
  });
  if (!full) return null;
  return { ...full, amount: '' };
}

/** True when the amount field is empty (ghost still pending). */
export function lineAmountIsEmpty(line) {
  return !String(line?.amount ?? '').trim();
}

/**
 * Commit empty amount → suggested_amount and refresh macros.
 * Leaves lines with a typed amount unchanged.
 */
export function commitLineSuggestedAmount(line, ing) {
  if (!line || !lineAmountIsEmpty(line)) return line;
  const suggested = String(line.suggested_amount ?? '').trim();
  if (!suggested) return line;
  const next = { ...line, amount: suggested };
  if (ing) return refreshReceiptLine(next, ing);
  return next;
}

/** Commit every empty ghost amount before submit / Cmd+Enter. */
export function commitAllSuggestedAmounts(lines, labelById = {}) {
  return (lines || []).map(line => {
    if (!lineAmountIsEmpty(line)) return line;
    const ing = line.label_ingredient_id != null
      ? labelById[String(line.label_ingredient_id)]
      : null;
    return commitLineSuggestedAmount(line, ing);
  });
}

/** Neighbor line id for arrow / remove navigation. */
export function adjacentReceiptLineId(lines, currentId, delta) {
  const list = lines || [];
  if (list.length === 0) return null;
  if (currentId == null) {
    return delta >= 0 ? list[0].id : list[list.length - 1].id;
  }
  const idx = list.findIndex(l => l.id === currentId);
  if (idx < 0) return delta >= 0 ? list[0].id : list[list.length - 1].id;
  const next = Math.min(list.length - 1, Math.max(0, idx + delta));
  return list[next].id;
}

/** Build a receipt line from a prepped batch (grams only). */
export function buildReceiptLineFromPreppedBatch(batch, amountG, { id } = {}) {
  if (!batch) return null;
  const g = Number(amountG);
  const rem = Number(batch.remaining_weight_g);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(rem) || rem <= 0) return null;
  const ratio = g / rem;
  return {
    id: id || newReceiptLineId(),
    prepped_batch_id: Number(batch.id),
    name: batch.name,
    amount: String(g),
    unit: 'g',
    tracking_type: 'weight',
    calories: r2(batch.remaining_calories * ratio),
    protein_g: r2(batch.remaining_protein_g * ratio),
    carbs_g: r2(batch.remaining_carbs_g * ratio),
    fat_g: r2(batch.remaining_fat_g * ratio),
    fiber_g: r2(Number(batch.remaining_fiber_g || 0) * ratio),
    source: 'library',
  };
}

/** Recompute macros on a prepped-batch line after amount change. */
export function refreshPreppedBatchLine(line, batch) {
  if (!line || !batch) return line;
  const rebuilt = buildReceiptLineFromPreppedBatch(batch, line.amount, { id: line.id });
  if (rebuilt) return rebuilt;
  return {
    ...line,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
  };
}

/** Recompute macros on a receipt line after amount/unit or ingredient swap. */
export function refreshReceiptLine(line, ing) {
  if (!line || !ing) return line;
  const macros = macrosForLabelServingAmount(ing, line.amount, line.unit);
  if (!macros) {
    return {
      ...line,
      name: ing.name,
      brand_name: ing.brand_name || null,
      label_ingredient_id: Number(ing.id),
      tracking_type: ing.tracking_type || 'weight',
      unit_name: ing.unit_name || null,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
    };
  }
  return {
    ...line,
    name: ing.name,
    brand_name: ing.brand_name || null,
    label_ingredient_id: Number(ing.id),
    tracking_type: ing.tracking_type || 'weight',
    unit_name: ing.unit_name || null,
    calories: macros.calories,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    fiber_g: macros.fiber_g,
  };
}

/**
 * Change a receipt line's unit, restating the amount so the food stays the
 * same: 1 cup of milk switched to ml becomes 236.59 ml, not 1 ml. Returns the
 * patch to apply, or null when the ingredient can't take that unit.
 */
export function changeLineUnit(line, ing, nextUnit) {
  const unit = canonicalUnit(nextUnit);
  if (!line || !ing || !unit) return null;
  if (!loggableUnitsFor(ing).includes(unit)) return null;
  const converted = convertForIngredient(ing, line.amount, line.unit, unit);
  // A blank or not-yet-valid amount just carries over with the new unit.
  const amount = converted == null ? line.amount : String(roundAmount(converted));
  return { amount, unit };
}

/**
 * Point a receipt line at a different ingredient (a substitution), keeping the
 * amount where that is meaningful. The unit is only carried over when the new
 * ingredient can actually be measured in it — otherwise the line resets to that
 * ingredient's own default, rather than relabelling "150 g" as "150 eggs".
 */
export function retargetLineToIngredient(line, ing) {
  if (!line || !ing) return null;
  const unit = canonicalUnit(line.unit);
  if (unit && loggableUnitsFor(ing).includes(unit)) {
    return { amount: line.amount, unit };
  }
  const def = defaultAmountForIngredient(ing);
  return { amount: def.amount, unit: canonicalUnit(def.unit) || 'g' };
}

export function sumReceiptMacros(lines) {
  const tot = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  let any = false;
  for (const l of lines || []) {
    if (!l || l.calories == null) continue;
    any = true;
    tot.calories += Number(l.calories) || 0;
    tot.protein_g += Number(l.protein_g) || 0;
    tot.carbs_g += Number(l.carbs_g) || 0;
    tot.fat_g += Number(l.fat_g) || 0;
    tot.fiber_g += Number(l.fiber_g) || 0;
  }
  return any ? tot : null;
}

/** Auto title for an ingredient-built meal when the user leaves the name blank. */
export function generateMealName(lines, { max = 3 } = {}) {
  const names = (lines || [])
    .map(l => String(l?.name ?? '').trim())
    .filter(Boolean);
  if (names.length === 0) return '';
  const head = names.slice(0, Math.max(1, max));
  const extra = names.length - head.length;
  const base = head.join(' + ');
  return extra > 0 ? `${base} + ${extra} more` : base;
}

const r2 = n => Math.round(Number(n) * 100) / 100;

/**
 * Scale a receipt into recipe ingredient rows by a factor (1 = whole batch,
 * 1/N = one equal meal-prep serving, 0.3 = 30% of a custom container split).
 */
function ingredientsFromReceiptScaled(lines, factor) {
  const ingredients = [];
  const f = Number(factor);
  const scale = Number.isFinite(f) && f > 0 ? f : 1;
  for (const l of lines) {
    if (!l) continue;
    const lineName = String(l.name ?? '').trim();
    if (!lineName) continue;
    const amount = Number(l.amount);
    const lid = Number(l.label_ingredient_id);
    const usable = Number.isFinite(amount) && amount > 0;
    const scaledAmt = usable ? roundAmount(amount * scale) : null;

    if (Number.isInteger(lid) && lid > 0 && usable && l.calories != null && scaledAmt != null && scaledAmt > 0) {
      ingredients.push({
        kind: 'ingredient',
        name: lineName,
        amount: String(scaledAmt),
        unit: canonicalUnit(l.unit) || 'g',
        label_ingredient_id: lid,
      });
    } else {
      ingredients.push({
        kind: 'line',
        name: lineName,
        amount:
          usable && scaledAmt != null && scaledAmt > 0
            ? formatAmountWithUnit(scaledAmt, l.unit)
            : 'as logged',
      });
    }
  }
  return ingredients;
}

function macrosScaled(totals, factor) {
  const f = Number(factor);
  const scale = Number.isFinite(f) && f > 0 ? f : 1;
  const t = totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  return {
    calories: r2(t.calories * scale),
    protein_g: r2(t.protein_g * scale),
    carbs_g: r2(t.carbs_g * scale),
    fat_g: r2(t.fat_g * scale),
    fiber_g: r2(t.fiber_g * scale),
  };
}

/**
 * Normalize custom container weights into fractions that sum to 1.
 * Accepts percents (sum ~100) or raw weights (any positive sum).
 * @returns {number[]|null}
 */
export function normalizeMealPrepFractions(weights) {
  if (!Array.isArray(weights) || weights.length < 2) return null;
  const nums = weights.map(w => Number(w));
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  return nums.map(n => n / sum);
}

/**
 * Turn the receipt the user just assembled into a POST /api/recipes body, so a
 * meal worked out in the log modal can be kept without retyping it in the Meal
 * Builder. Returns null when there is no name or nothing usable to save.
 *
 * Library-backed rows become `kind: 'ingredient'` lines carrying their
 * label_ingredient_id, which is what keeps the saved recipe editable and
 * substitutable later rather than a frozen block of numbers. Anything without a
 * library link is kept as a free-text `kind: 'line'` so it stays visible in the
 * recipe instead of silently vanishing from the total.
 *
 * Pass `{ mealPrepServings: N }` (N ≥ 2) to save an equal N-way meal prep:
 * per-serving macros/amounts and a limited-use template with N uses — same
 * model as the AI logger meal-prep path.
 */
export function buildRecipeFromReceipt(receipt, name, options = {}) {
  const recipeName = String(name ?? '').trim();
  if (!recipeName) return null;

  const lines = Array.isArray(receipt) ? receipt : [];
  const mealPrepServings = Number(options?.mealPrepServings);
  const isPrep = Number.isInteger(mealPrepServings) && mealPrepServings >= 2 && mealPrepServings <= 50;
  const factor = isPrep ? 1 / mealPrepServings : 1;

  const ingredients = ingredientsFromReceiptScaled(lines, factor);
  if (ingredients.length === 0) return null;

  const t = sumReceiptMacros(lines) || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const macros = macrosScaled(t, factor);

  if (isPrep) {
    return {
      name: recipeName,
      serving_size: `1 of ${mealPrepServings} meal-prep servings`,
      ...macros,
      ingredients,
      recipe_kind: 'limited',
      remaining_uses: mealPrepServings,
      max_uses: mealPrepServings,
      meal_builder_meta: { source: 'log_meal_prep', containers: mealPrepServings, split: 'equal' },
    };
  }

  return {
    name: recipeName,
    serving_size: '1 meal',
    ...macros,
    ingredients,
    meal_builder_meta: { source: 'log_receipt' },
  };
}

/**
 * Unequal meal-prep split: one limited recipe per container (1 use each),
 * scaled by the given weights/percents. Use when containers are not equal.
 * @returns {object[]|null}
 */
export function buildUnequalMealPrepRecipes(receipt, name, weights) {
  const recipeName = String(name ?? '').trim();
  if (!recipeName) return null;
  const fractions = normalizeMealPrepFractions(weights);
  if (!fractions) return null;

  const lines = Array.isArray(receipt) ? receipt : [];
  const t = sumReceiptMacros(lines) || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const n = fractions.length;
  const bodies = [];

  for (let i = 0; i < n; i++) {
    const frac = fractions[i];
    const ingredients = ingredientsFromReceiptScaled(lines, frac);
    if (ingredients.length === 0) return null;
    const macros = macrosScaled(t, frac);
    const pct = Math.round(frac * 1000) / 10;
    bodies.push({
      name: n === 1 ? recipeName : `${recipeName} (${i + 1}/${n})`,
      serving_size: `1 of ${n} meal-prep servings · ${pct}%`,
      ...macros,
      ingredients,
      recipe_kind: 'limited',
      remaining_uses: 1,
      max_uses: 1,
      meal_builder_meta: {
        source: 'log_meal_prep',
        containers: n,
        split: 'custom',
        container_index: i + 1,
        fraction: frac,
      },
    });
  }
  return bodies;
}

/**
 * Save an already-logged meal as a recipe, straight from its row in the day.
 *
 * A logged entry stores its ingredient rows PER SERVING, which is the same
 * basis a recipe wants, so the servings count is deliberately not applied —
 * logging two servings of something still saves the recipe for one.
 *
 * Meals with no ingredient breakdown (a plain recipe log, a quick food) keep
 * their own macros so they are still re-loggable, just without lines.
 *
 * Pass `{ mealPrepServings: N }` to turn the saved meal into an equal N-way
 * limited meal-prep template (same as saving from the Log Meal receipt).
 */
export function buildRecipeFromLogEntry(entry, name, options = {}) {
  const recipeName = String(name ?? '').trim();
  if (!entry || !recipeName) return null;

  const rows = parseLoggedIngredients(entry);
  if (rows && rows.length) return buildRecipeFromReceipt(rows, recipeName, options);

  const macros = [entry.recipe_calories, entry.recipe_protein_g, entry.recipe_carbs_g, entry.recipe_fat_g];
  if (!macros.every(v => Number.isFinite(Number(v)))) return null;

  const mealPrepServings = Number(options?.mealPrepServings);
  const isPrep = Number.isInteger(mealPrepServings) && mealPrepServings >= 2 && mealPrepServings <= 50;
  const factor = isPrep ? 1 / mealPrepServings : 1;
  const base = {
    name: recipeName,
    calories: r2(Number(entry.recipe_calories) * factor),
    protein_g: r2(Number(entry.recipe_protein_g) * factor),
    carbs_g: r2(Number(entry.recipe_carbs_g) * factor),
    fat_g: r2(Number(entry.recipe_fat_g) * factor),
    ...(Number.isFinite(Number(entry.recipe_fiber_g))
      ? { fiber_g: r2(Number(entry.recipe_fiber_g) * factor) }
      : {}),
    ingredients: [],
  };

  if (isPrep) {
    return {
      ...base,
      serving_size: `1 of ${mealPrepServings} meal-prep servings`,
      recipe_kind: 'limited',
      remaining_uses: mealPrepServings,
      max_uses: mealPrepServings,
      meal_builder_meta: { source: 'log_meal_prep', containers: mealPrepServings, split: 'equal' },
    };
  }

  return {
    ...base,
    serving_size: entry.serving_size || '1 meal',
    meal_builder_meta: { source: 'log_entry' },
  };
}

/** Payload rows for POST /api/log ingredients. */
export function receiptToApiIngredients(lines) {
  return (lines || [])
    .filter(l => l && Number(l.amount) > 0 && l.calories != null)
    .map(l => ({
      name: l.name,
      amount: Number(l.amount),
      unit: l.unit,
      calories: l.calories,
      protein_g: l.protein_g,
      carbs_g: l.carbs_g,
      fat_g: l.fat_g,
      fiber_g: l.fiber_g,
      source: l.source || 'library',
      label_ingredient_id: l.label_ingredient_id,
      prepped_batch_id: l.prepped_batch_id,
    }));
}

/**
 * Seed receipt lines from a recipe + optional remembered amounts
 * (`{ [label_ingredient_id]: { amount, unit } }`).
 */
export function seedReceiptFromRecipe(recipe, labelById, remembered = {}) {
  const template = listRecipeIngredientLines(recipe);
  const lines = [];
  for (const t of template) {
    const ing = labelById[String(t.label_ingredient_id)];
    if (!ing) continue;
    const mem = remembered[String(t.label_ingredient_id)] || remembered[t.label_ingredient_id];
    let amount = t.amount;
    let unit = t.unit;
    if (mem && Number(mem.amount) > 0) {
      amount = String(mem.amount);
      // Restore the remembered unit whenever the ingredient can still be
      // measured in it, so a meal last logged in ml comes back in ml. Only
      // g/oz used to survive, which re-seeded every other unit's number
      // against a different unit entirely.
      const memUnit = canonicalUnit(mem.unit);
      if (memUnit && loggableUnitsFor(ing).includes(memUnit)) {
        unit = memUnit;
      } else if (ing.tracking_type === 'unit') {
        unit = ing.unit_name || unit;
      }
    } else if (ing.tracking_type === 'unit') {
      unit = ing.unit_name || unit;
    }
    const line = buildReceiptLine(ing, amount, unit, { source: 'recipe' });
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Seed a receipt from a log's `ingredients_json` rows (array or JSON string).
 * Library-linked rows rebuild live macros; orphaned rows keep stored macros.
 */
export function seedReceiptFromIngredientsJson(rows, labelById = {}) {
  let parsed = rows;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return [];
  const lines = [];
  for (const r of parsed) {
    if (!r || typeof r !== 'object') continue;
    const lid = Number(r.label_ingredient_id);
    const ing = Number.isInteger(lid) && lid > 0
      ? (labelById[String(lid)] || labelById[lid])
      : null;
    if (ing) {
      const line = buildReceiptLine(ing, r.amount, r.unit || 'g', {
        source: r.source || 'library',
      });
      if (line) lines.push(line);
      continue;
    }
    if (r.name && r.calories != null) {
      lines.push({
        id: newReceiptLineId(),
        label_ingredient_id: Number.isInteger(lid) && lid > 0 ? lid : null,
        name: r.name,
        amount: String(r.amount ?? ''),
        unit: r.unit || '',
        calories: r.calories,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
        fiber_g: r.fiber_g,
        source: r.source || 'estimated',
      });
    }
  }
  return lines;
}

/**
 * Seed a receipt from a historical log's `slot_selections_json` (substitutions
 * + amounts). Used when `ingredients_json` is missing so editing an old log
 * does not fall back to the current recipe template.
 */
export function seedReceiptFromLoggedSelections(slotSelections, labelById) {
  let parsed = slotSelections;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const lines = [];
  for (const v of Object.values(parsed)) {
    if (v == null) continue;
    let lid;
    let amount;
    let unit;
    if (typeof v === 'object') {
      lid = Number(v.label_ingredient_id);
      amount = v.amount;
      unit = v.unit;
    } else {
      lid = Number(v);
    }
    if (!Number.isInteger(lid) || lid <= 0) continue;
    const ing = labelById?.[String(lid)] || labelById?.[lid];
    if (!ing) continue;
    let amt = amount != null && Number(amount) > 0 ? String(amount) : null;
    let u = persistAmountUnit(unit);
    if (!amt) {
      const def = defaultAmountForIngredient(ing);
      amt = def.amount;
      u = def.unit;
    } else if (ing.tracking_type === 'unit') {
      u = ing.unit_name || u;
    }
    const line = buildReceiptLine(ing, amt, u, { source: 'library' });
    if (line) lines.push(line);
  }
  return lines;
}

/** localStorage helpers keyed by recipe + label_ingredient_id */
export function lastAmountsKey(recipeId) {
  return `nlog_receiptAmounts_${recipeId}`;
}

export function loadLastReceiptAmounts(recipeId) {
  try {
    const raw = localStorage.getItem(lastAmountsKey(recipeId));
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function saveLastReceiptAmounts(recipeId, amountsByLid) {
  try {
    localStorage.setItem(lastAmountsKey(recipeId), JSON.stringify(amountsByLid));
  } catch {
    /* storage may be unavailable */
  }
}

/** Equal-split meal prep (single limited recipe, not custom % siblings). */
export function isEqualSplitMealPrep(recipe) {
  if (!recipe || (recipe.recipe_kind || 'permanent') !== 'limited') return false;
  const meta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object'
    ? recipe.meal_builder_meta
    : null;
  if (meta?.split === 'custom') return false;
  if (meta?.split === 'equal') return true;
  const src = meta?.source;
  if (src === 'log_meal_prep' || src === 'ai_meal_prep') return true;
  return /meal-prep/i.test(recipe.serving_size || '');
}

export function mealPrepContainerCount(recipe) {
  const meta = recipe?.meal_builder_meta;
  const fromMeta = meta && typeof meta === 'object' ? Number(meta.containers) : NaN;
  if (Number.isInteger(fromMeta) && fromMeta >= 2) return fromMeta;
  const max = Number(recipe?.max_uses);
  if (Number.isInteger(max) && max >= 2) return max;
  return null;
}

/**
 * Add ingredients to an equal-split meal prep, dividing batch amounts evenly
 * across original containers. Preserves remaining_uses — caller PUTs macros +
 * ingredients only.
 */
export function augmentMealPrepRecipe(existingRecipe, addedReceiptLines, { splitBy } = {}) {
  if (!existingRecipe || !isEqualSplitMealPrep(existingRecipe)) return null;
  const n = Number(splitBy ?? mealPrepContainerCount(existingRecipe));
  if (!Number.isInteger(n) || n < 2 || n > 50) return null;

  const added = Array.isArray(addedReceiptLines) ? addedReceiptLines : [];
  if (added.length === 0) return null;

  const invalid = added.some(l => !l || !Number(l.amount) || Number(l.amount) <= 0 || l.calories == null);
  if (invalid) return null;

  const factor = 1 / n;
  const perServingAdds = ingredientsFromReceiptScaled(added, factor);
  const addMacros = macrosScaled(sumReceiptMacros(added), factor);

  const existingLines = listRecipeIngredientLines(existingRecipe);
  const merged = new Map();
  for (const line of existingLines) {
    merged.set(Number(line.label_ingredient_id), { ...line });
  }
  for (const row of perServingAdds) {
    if (row.kind !== 'ingredient' || !row.label_ingredient_id) continue;
    const lid = Number(row.label_ingredient_id);
    const prev = merged.get(lid);
    if (prev) {
      const amt = roundAmount(Number(prev.amount) + Number(row.amount));
      merged.set(lid, { ...prev, amount: String(amt), unit: row.unit || prev.unit });
    } else {
      merged.set(lid, {
        label_ingredient_id: lid,
        name: row.name,
        amount: row.amount,
        unit: row.unit,
      });
    }
  }

  const ingredients = [...merged.values()].map(line => ({
    kind: 'ingredient',
    name: line.name,
    amount: line.amount,
    unit: persistAmountUnit(line.unit),
    label_ingredient_id: line.label_ingredient_id,
  }));
  if (ingredients.length === 0) return null;

  const base = {
    calories: Number(existingRecipe.calories) || 0,
    protein_g: Number(existingRecipe.protein_g) || 0,
    carbs_g: Number(existingRecipe.carbs_g) || 0,
    fat_g: Number(existingRecipe.fat_g) || 0,
    fiber_g: Number(existingRecipe.fiber_g) || 0,
  };
  const macros = {
    calories: r2(base.calories + addMacros.calories),
    protein_g: r2(base.protein_g + addMacros.protein_g),
    carbs_g: r2(base.carbs_g + addMacros.carbs_g),
    fat_g: r2(base.fat_g + addMacros.fat_g),
    fiber_g: r2((base.fiber_g || 0) + (addMacros.fiber_g || 0)),
  };

  return {
    name: existingRecipe.name,
    serving_size: existingRecipe.serving_size,
    ...macros,
    ingredients,
  };
}

/** Heuristic substitute suggestions (fallback when AI is unavailable). */
export function getSuggestedSubstitutes(defaultIng, candidates, { excludeId, limit = 5 } = {}) {
  const pool = (candidates || []).filter(x => x && Number(x.id) !== Number(excludeId || defaultIng?.id));
  if (!defaultIng || pool.length === 0) {
    return [...pool]
      .sort((a, b) => new Date(b.last_used_at || 0) - new Date(a.last_used_at || 0))
      .slice(0, limit);
  }
  const defName = (defaultIng.name || '').toLowerCase();
  const defBase = (defaultIng.base_label || '').toLowerCase();
  const scored = pool.map(x => {
    const xName = (x.name || '').toLowerCase();
    const xBase = (x.base_label || '').toLowerCase();
    let score = 0;
    if (defBase && xBase && xBase === defBase) score += 3;
    if (defName && xName.includes(defName)) score += 2;
    if (defName && defName.includes(xName) && xName.length > 3) score += 1;
    if (x.last_used_at) score += 0.5;
    return { x, score };
  });
  const matched = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).map(r => r.x);
  if (matched.length >= limit) return matched.slice(0, limit);
  const matchedIds = new Set(matched.map(x => x.id));
  const filler = [...pool]
    .filter(x => !matchedIds.has(x.id))
    .sort((a, b) => new Date(b.last_used_at || 0) - new Date(a.last_used_at || 0))
    .slice(0, limit - matched.length);
  return [...matched, ...filler];
}
