/**
 * mealMicros — resolving a micronutrient blob for a set of ingredients.
 *
 * Extracted from routes/log.js so the Recipe Library can show the SAME numbers
 * logging would produce. One pipeline, one set of rules: measured label values
 * where an ingredient carries them, an AI estimate only for the rest.
 */

const { buildMicrosBlob } = require('./microNutrients');
const { estimateMicrosFromIngredients } = require('./microEstimateService');
const { labelMicrosForRows, mergeMicros } = require('./labelMicros');

const MICRO_TIMEOUT_MS = 9000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('micro estimate timeout')), ms)),
  ]);
}

/** Estimate micros from an ingredient list -> micros_json string, or null. Best-effort; never throws. */
async function microsJsonFromIngredients(ingredients) {
  try {
    const blob = await withTimeout(estimateMicrosFromIngredients(ingredients), MICRO_TIMEOUT_MS);
    return blob ? JSON.stringify(blob) : null;
  } catch {
    return null; // micro estimation is optional — never block the caller
  }
}

/**
 * Micros for a set of rows, preferring each ingredient's own product label over
 * an AI estimate. Rows whose library entry carries label micros (captured on
 * barcode import) contribute measured values; only the rest are estimated, and
 * when every row is covered no AI call happens at all.
 */
async function microsJsonPreferringLabels(db, ingredients) {
  const { micros: labelValues, covered, uncovered } = labelMicrosForRows(db, ingredients);
  if (covered.length === 0) return microsJsonFromIngredients(ingredients);

  let estimated = null;
  if (uncovered.length > 0) {
    const json = await microsJsonFromIngredients(uncovered);
    try {
      estimated = json ? JSON.parse(json)?.micros : null;
    } catch {
      estimated = null;
    }
  }

  const merged = mergeMicros(labelValues, estimated);
  // "high" only when every row was measured; any estimated row drags it down.
  const confidence = uncovered.length === 0 ? 'high' : 'medium';
  const notes =
    uncovered.length === 0
      ? 'From product labels'
      : `${covered.length} of ${covered.length + uncovered.length} ingredients from product labels; the rest estimated`;
  const blob = buildMicrosBlob(merged, { confidence, notes });
  return blob ? JSON.stringify(blob) : null;
}

/** Normalize a recipe row's ingredients to [{name,amount,unit}] (meal_builder_meta.lines preferred). */
function normalizedIngredientsFromRecipe(db, recipe) {
  try {
    const meta = recipe.meal_builder_meta ? JSON.parse(recipe.meal_builder_meta) : null;
    if (meta && Array.isArray(meta.lines) && meta.lines.length) {
      const out = meta.lines
        .map(l => ({ name: String(l?.name || '').trim(), amount: l?.amount, unit: l?.unit || '' }))
        .filter(x => x.name);
      if (out.length) return out;
    }
  } catch { /* fall through to ingredients column */ }

  let ing;
  try { ing = recipe.ingredients ? JSON.parse(recipe.ingredients) : []; } catch { ing = []; }
  if (!Array.isArray(ing)) return [];
  const labelName = db.prepare('SELECT name FROM label_ingredients WHERE id = ?');
  const out = [];
  for (const item of ing) {
    if (item && item.kind === 'slot') {
      const ids = Array.isArray(item.option_label_ingredient_ids) ? item.option_label_ingredient_ids : [];
      let nm = item.label || '';
      if (ids[0]) { const r = labelName.get(ids[0]); if (r?.name) nm = r.name; }
      if (nm) out.push({ name: String(nm).trim(), amount: item.amount, unit: item.unit || '' });
    } else if (item && item.name) {
      out.push({ name: String(item.name).trim(), amount: item.amount, unit: '' });
    }
  }
  return out;
}

module.exports = {
  MICRO_TIMEOUT_MS,
  microsJsonFromIngredients,
  microsJsonPreferringLabels,
  normalizedIngredientsFromRecipe,
};
