/**
 * labelMicros — micronutrients taken from an ingredient's own product label
 * (captured on barcode import) rather than estimated by the AI.
 *
 * Label values are measured by the manufacturer, so they win: the log route
 * sums whatever the logged rows can supply from their library entries, and only
 * asks the AI about the rows that have nothing stored. A meal built entirely
 * from barcoded ingredients therefore needs no AI call at all.
 */

const { MICRO_KEYS } = require('./microNutrients');

/**
 * How many of an ingredient's stored servings a logged row represents.
 * Mirrors the macro math in recipeIngredients.ingredientMacrosForAmount:
 * unit-tracked rows count servings, weight-tracked rows divide grams.
 * @returns {number|null} null when the row can't be resolved
 */
function servingsMultiplier(ingRow, amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;

  if (ingRow?.tracking_type === 'unit') {
    const per = Number(ingRow.serving_quantity);
    return value / (Number.isFinite(per) && per > 0 ? per : 1);
  }
  const grams = String(unit || '').toLowerCase() === 'oz' ? value * 28.349523125 : value;
  const perServing = Number(ingRow?.grams_per_serving);
  if (!Number.isFinite(perServing) || perServing <= 0) return null;
  return grams / perServing;
}

/** Stored blob -> flat { key: amount }, or null when absent/unusable. */
function storedMicros(micros_json) {
  if (!micros_json) return null;
  try {
    const parsed = typeof micros_json === 'string' ? JSON.parse(micros_json) : micros_json;
    const micros = parsed?.micros;
    if (!micros || typeof micros !== 'object') return null;
    const out = {};
    for (const key of MICRO_KEYS) {
      const value = Number(micros[key]);
      if (Number.isFinite(value) && value > 0) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Split logged rows by whether their library entry carries label micros.
 *
 * @param {object} db
 * @param {Array<{label_ingredient_id?: number, amount?: number, unit?: string}>} rows
 * @returns {{micros: object, covered: Array, uncovered: Array}}
 *   `micros` is the summed label contribution; `uncovered` is what still needs
 *   estimating.
 */
function labelMicrosForRows(db, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const micros = {};
  const covered = [];
  const uncovered = [];
  if (list.length === 0) return { micros, covered, uncovered };

  const get = db.prepare(
    'SELECT id, micros_json, tracking_type, serving_quantity, grams_per_serving FROM label_ingredients WHERE id = ? AND user_id = 0'
  );
  const cache = new Map();

  for (const row of list) {
    const id = Number(row?.label_ingredient_id);
    if (!Number.isInteger(id) || id <= 0) {
      uncovered.push(row);
      continue;
    }
    if (!cache.has(id)) cache.set(id, get.get(id) || null);
    const ing = cache.get(id);
    const stored = storedMicros(ing?.micros_json);
    if (!stored) {
      uncovered.push(row);
      continue;
    }
    const multiplier = servingsMultiplier(ing, row?.amount, row?.unit);
    if (multiplier == null) {
      uncovered.push(row);
      continue;
    }
    for (const [key, value] of Object.entries(stored)) {
      micros[key] = (micros[key] || 0) + value * multiplier;
    }
    covered.push(row);
  }

  for (const key of Object.keys(micros)) {
    micros[key] = Math.round(micros[key] * 100) / 100;
  }
  return { micros, covered, uncovered };
}

/**
 * Merge label micros over estimated ones. A nutrient measured on a label always
 * replaces the estimate for that nutrient — mixing the two per-nutrient is the
 * point, since a label rarely lists all twelve.
 */
function mergeMicros(labelValues, estimatedValues) {
  const out = {};
  for (const key of MICRO_KEYS) {
    const estimated = Number(estimatedValues?.[key]);
    if (Number.isFinite(estimated) && estimated > 0) out[key] = Math.round(estimated * 100) / 100;
    const measured = Number(labelValues?.[key]);
    if (Number.isFinite(measured) && measured > 0) out[key] = Math.round(measured * 100) / 100;
  }
  return out;
}

module.exports = { labelMicrosForRows, mergeMicros, servingsMultiplier, storedMicros };
