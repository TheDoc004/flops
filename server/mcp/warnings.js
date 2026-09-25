/**
 * Non-blocking MCP write warnings. Never reject a write — only inform.
 */

function round(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

const OIL_FAT_RE = /\b(oil|butter|ghee|lard|shortening|mayo|mayonnaise)\b/i;
const SEASONING_RE = /\b(salt|pepper|spice|seasoning|extract|baking\s*(soda|powder)|water)\b/i;
const WHOLE_FOOD_HINT_RE =
  /\b(oat|rice|bean|lentil|chickpea|quinoa|potato|apple|banana|berry|spinach|kale|broccoli|chicken|beef|turkey|egg|yogurt|milk|bread|pasta|popcorn|kernel|almond|walnut|peanut|avocado|tomato|carrot)\b/i;

function hasFiber(fiber) {
  return fiber != null && fiber !== '' && Number.isFinite(Number(fiber));
}

function hasMicros(micros) {
  if (!micros) return false;
  if (typeof micros === 'string') {
    try {
      micros = JSON.parse(micros);
    } catch {
      return false;
    }
  }
  const src = micros.micros && typeof micros.micros === 'object' ? micros.micros : micros;
  if (!src || typeof src !== 'object') return false;
  return Object.values(src).some(v => Number.isFinite(Number(v)) && Number(v) > 0);
}

/** Per-100g (or per-serving scaled) food warnings. */
function warningsForFoodMacros({
  name,
  calories,
  protein_g,
  carbs_g,
  fat_g,
  fiber_g,
  micros,
  nutrition_source,
  basis = 'per_100g',
}) {
  const warnings = [];
  const carbs = Number(carbs_g) || 0;
  const cal = Number(calories) || 0;
  const p = Number(protein_g) || 0;
  const f = Number(fat_g) || 0;

  // Fiber missing when carbs suggest a plant food that usually has fiber.
  if (!hasFiber(fiber_g) && carbs >= 15 && !SEASONING_RE.test(name || '')) {
    warnings.push(
      `No fiber value on "${name}" (${basis}) despite ${round(carbs, 0)}g carbs — ` +
        'plant foods often have fiber; this will undercount daily fiber.'
    );
  }

  // Whole-food-ish name with no micros.
  if (
    !hasMicros(micros) &&
    WHOLE_FOOD_HINT_RE.test(name || '') &&
    !OIL_FAT_RE.test(name || '') &&
    !SEASONING_RE.test(name || '')
  ) {
    warnings.push(
      `No micronutrients on "${name}" — whole foods usually carry micros; estimates may be incomplete.`
    );
  }

  // Calorie vs 4/4/9 reconciliation (on the same basis as the macros).
  const implied = 4 * p + 4 * carbs + 9 * f;
  if (cal > 0 && implied > 0) {
    const delta = Math.abs(cal - implied);
    const tol = Math.max(40, cal * 0.12);
    if (delta > tol) {
      warnings.push(
        `Calories (${round(cal, 0)}) don't match 4/4/9 from macros (~${round(implied, 0)}) ` +
          `for "${name}" — delta ${round(delta, 0)} ${basis}.`
      );
    }
  }

  if (nutrition_source === 'estimate') {
    warnings.push(`nutrition_source is estimate for "${name}" — numbers were inferred, not from a label.`);
  }

  return warnings;
}

function warningsForMealQuantity(item) {
  const warnings = [];
  const qty = Number(item?.quantity_g);
  const name = item?.name || 'item';
  if (!Number.isFinite(qty) || qty <= 0) return warnings;

  if (OIL_FAT_RE.test(name) && qty >= 100) {
    warnings.push(
      `Quantity ${qty}g of "${name}" looks like a unit error (oils/fats are usually tablespoons, not 100g+).`
    );
  } else if (qty >= 900) {
    warnings.push(
      `Quantity ${qty}g of "${name}" is unusually large — double-check units (g vs serving).`
    );
  }
  return warnings;
}

function warningsForMealTotals(totals, items) {
  const warnings = [];
  const cal = Number(totals?.calories) || 0;
  const p = Number(totals?.protein_g) || 0;
  const c = Number(totals?.carbs_g) || 0;
  const f = Number(totals?.fat_g) || 0;
  const implied = 4 * p + 4 * c + 9 * f;
  if (cal > 0 && implied > 0) {
    const delta = Math.abs(cal - implied);
    const tol = Math.max(50, cal * 0.12);
    if (delta > tol) {
      warnings.push(
        `Meal calories (${round(cal, 0)}) don't reconcile with 4/4/9 from macros (~${round(implied, 0)}); delta ${round(delta, 0)}.`
      );
    }
  }
  for (const it of items || []) {
    warnings.push(...warningsForMealQuantity(it));
    if (it.kind === 'new_food' || it.per_100g) {
      const per = it.per_100g || {};
      warnings.push(
        ...warningsForFoodMacros({
          name: it.name,
          calories: per.calories,
          protein_g: per.protein_g,
          carbs_g: per.carbs_g,
          fat_g: per.fat_g,
          fiber_g: per.fiber_g,
          micros: it.micros_per_100g,
          nutrition_source: it.nutrition_source,
          basis: 'per_100g',
        })
      );
    } else if (it.macros && it.nutrition_source === 'estimate') {
      warnings.push(`Item "${it.name}" uses nutrition_source=estimate.`);
    }
  }
  return warnings;
}

module.exports = {
  warningsForFoodMacros,
  warningsForMealQuantity,
  warningsForMealTotals,
  hasFiber,
  hasMicros,
};
