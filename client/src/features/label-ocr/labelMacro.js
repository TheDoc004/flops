import { amountInBasisUnit } from '@shared/utils/unitConvert';

/** US food label oz → grams (mass) */
export const OZ_TO_G = 28.349523125;

export function gramsFromAmount(value, unit, { allowZero = false } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (allowZero ? v < 0 : v <= 0) return null;
  const u = String(unit || 'g').toLowerCase();
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return v * OZ_TO_G;
  return v;
}

/**
 * How many of the ingredient's stored servings `amountValue unit` comes to.
 *
 * The amount is first restated in the ingredient's OWN serving unit — which is
 * what lets a milk saved as "1 cup" be logged as 200 ml or 7 oz — and then
 * divided by the size of one serving. Returns null when the ingredient cannot
 * be measured in that unit; callers must NOT fall back to treating the number
 * as a raw count, which is how "2 slices" used to silently scale a per-cup item.
 */
export function servingsForAmount(ing, amountValue, unit, { allowZero = false } = {}) {
  if (!ing) return null;
  const v = Number(amountValue);
  if (!Number.isFinite(v)) return null;
  if (allowZero ? v < 0 : v <= 0) return null;

  const inBasis = amountInBasisUnit(ing, v, unit);
  if (inBasis == null) return null;

  // One serving, measured in that same basis unit.
  const perServing = ing.tracking_type === 'unit'
    ? Number(ing.serving_quantity)
    : Number(ing.grams_per_serving);
  if (Number.isFinite(perServing) && perServing > 0) return inBasis / perServing;
  // A count defaults to one per serving; a grams-per-serving item never guesses.
  return ing.tracking_type === 'unit' ? inBasis : null;
}

/**
 * Macros for the amount actually used, given label values are **per serving**.
 *
 * Works for any unit the ingredient can be measured in (see unitConvert): grams
 * and ounces for a grams-per-serving item; the item's own unit, related volumes,
 * and — when a gram equivalent is recorded — weights for a unit-based one.
 * Returns null rather than mis-scaling an incompatible unit.
 */
export function macrosForLabelServingAmount(ing, amountValue, unit, options) {
  const mult = servingsForAmount(ing, amountValue, unit, options);
  if (mult == null) return null;
  return {
    calories: Number(ing.calories) * mult,
    protein_g: Number(ing.protein_g) * mult,
    carbs_g: Number(ing.carbs_g) * mult,
    fat_g: Number(ing.fat_g) * mult,
    fiber_g: ing.fiber_g != null && ing.fiber_g !== '' ? Number(ing.fiber_g) * mult : 0,
  };
}

export function sumMacroObjects(rows) {
  return rows.reduce(
    (acc, m) => {
      if (!m) return acc;
      acc.calories += m.calories || 0;
      acc.protein_g += m.protein_g || 0;
      acc.carbs_g += m.carbs_g || 0;
      acc.fat_g += m.fat_g || 0;
      acc.fiber_g += m.fiber_g || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }
  );
}
