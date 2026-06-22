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
 * Macros for the amount actually used, given label values are **per serving**
 * and grams_per_serving is the mass of one serving.
 *
 * For unit-based ingredients (tracking_type === 'unit'), amountValue is a count
 * of units scaled against serving_quantity (defaults to 1 if unset).
 */
export function macrosForLabelServingAmount(ing, amountValue, unit, options) {
  if (ing.tracking_type === 'unit') {
    const count = Number(amountValue);
    if (!Number.isFinite(count) || count <= 0) return null;
    const sq = Number(ing.serving_quantity);
    const mult = count / (Number.isFinite(sq) && sq > 0 ? sq : 1);
    return {
      calories: Number(ing.calories) * mult,
      protein_g: Number(ing.protein_g) * mult,
      carbs_g: Number(ing.carbs_g) * mult,
      fat_g: Number(ing.fat_g) * mult,
      fiber_g: ing.fiber_g != null && ing.fiber_g !== '' ? Number(ing.fiber_g) * mult : 0,
    };
  }
  const gUsed = gramsFromAmount(amountValue, unit, options);
  if (gUsed == null) return null;
  const gps = Number(ing.grams_per_serving);
  if (!Number.isFinite(gps) || gps <= 0) return null;
  const mult = gUsed / gps;
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
