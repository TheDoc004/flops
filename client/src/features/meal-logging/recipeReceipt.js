/**
 * Recipe → Log Meal receipt helpers.
 * Recipes are named ingredient lists that seed an editable receipt.
 */

import { macrosForLabelServingAmount } from '@features/label-ocr';
import { convertForIngredient, loggableUnitsFor, roundAmount, canonicalUnit } from '@shared/utils/unitConvert';

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
export function buildReceiptLine(ing, amount, unit, { id, source = 'library' } = {}) {
  if (!ing) return null;
  const amt = amount != null ? String(amount) : '';
  // Always canonical, so the unit a line is computed in is the unit the picker
  // shows as selected — "Cups" and "cup" must not be two different things.
  const u = canonicalUnit(unit) || 'g';
  const macros = macrosForLabelServingAmount(ing, amt, u);
  if (!macros) return null;
  return {
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
      if (ing.tracking_type === 'unit') {
        unit = ing.unit_name || unit;
      } else if (mem.unit === 'oz' || mem.unit === 'g') {
        unit = mem.unit;
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
