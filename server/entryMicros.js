/**
 * Part B — resolve meal micronutrients at read time from ingredient-library
 * micros_json (live-scaled), instead of trusting a frozen AI blob on the meal.
 *
 * Prefer library values whenever any logged ingredient carries micros.
 * Fall back to legacy log_entries.micros_json only when nothing can be derived
 * (old meals without linked ingredients / without library micros yet).
 */
const { buildMicrosBlob, MICRO_KEYS } = require('./microNutrients');
const { labelMicrosForRows } = require('./labelMicros');

const CONF_RANK = { low: 0, medium: 1, high: 2 };

function lowestConfidence(list) {
  if (!list || !list.length) return null;
  return list.reduce(
    (acc, c) => ((CONF_RANK[c] ?? 0) < (CONF_RANK[acc] ?? 0) ? c : acc),
    list[0]
  );
}

function parseIngredientsJson(raw) {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseFrozenBlob(micros_json) {
  if (!micros_json) return null;
  try {
    const p = typeof micros_json === 'string' ? JSON.parse(micros_json) : micros_json;
    if (!p || typeof p !== 'object' || !p.micros || typeof p.micros !== 'object') return null;
    if (!Object.values(p.micros).some(v => Number(v) > 0)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Display names of logged rows that contributed no micros. */
function missingIngredientNames(rows) {
  return (rows || []).map(r => String(r?.name || '').trim() || 'Unnamed ingredient');
}

/**
 * @returns {{
 *   blob: object|null,
 *   source: 'ingredients'|'frozen'|null,
 *   coverage: { covered: number, uncovered: number, ingredient_rows: number, missing_ingredients: string[] }
 * }}
 */
function resolveEntryMicros(db, userId, entry) {
  const ingredients = parseIngredientsJson(entry?.ingredients_json);
  const fromLib = ingredients.length
    ? labelMicrosForRows(db, ingredients, userId)
    : { micros: {}, covered: [], uncovered: [], confidences: [] };

  const missing = missingIngredientNames(fromLib.uncovered);
  const coverage = {
    covered: fromLib.covered.length,
    uncovered: fromLib.uncovered.length,
    ingredient_rows: ingredients.length,
    missing_ingredients: missing,
  };

  const liveKeys = Object.keys(fromLib.micros || {}).filter(k => Number(fromLib.micros[k]) > 0);
  if (liveKeys.length) {
    let confidence = lowestConfidence(fromLib.confidences) || 'medium';
    // Partial coverage must never claim label-exact high.
    if (fromLib.uncovered.length > 0 && confidence === 'high') confidence = 'medium';
    const notes =
      fromLib.uncovered.length === 0
        ? 'Live from ingredient library'
        : `Not counted (no micronutrient data yet): ${missing.join(', ')}`;
    const blob = buildMicrosBlob(fromLib.micros, { confidence, notes });
    // Rows without library micros add nothing to these totals. Say which, so a
    // missing food reads as "not counted" rather than as a real zero.
    if (blob && missing.length) blob.missing_ingredients = missing;
    return { blob, source: blob ? 'ingredients' : null, coverage };
  }

  const frozen = parseFrozenBlob(entry?.micros_json);
  if (frozen) {
    return {
      blob: {
        micros: Object.fromEntries(
          MICRO_KEYS.map(k => [k, frozen.micros[k]]).filter(([, v]) => Number(v) > 0)
        ),
        confidence: frozen.confidence || null,
        notes: frozen.notes || 'Legacy frozen meal estimate',
        version: frozen.version || null,
        estimatedAt: frozen.estimatedAt || null,
      },
      source: 'frozen',
      coverage,
    };
  }

  return { blob: null, source: null, coverage };
}

/** micros_json string for API responses (live overlay), or null. */
function microsJsonForApi(db, userId, entry) {
  const { blob } = resolveEntryMicros(db, userId, entry);
  return blob ? JSON.stringify(blob) : null;
}

/** Copy a log row with micros_json replaced by the live-resolved blob. */
function withResolvedMicros(db, userId, row) {
  if (!row) return row;
  return { ...row, micros_json: microsJsonForApi(db, userId, row) };
}

module.exports = {
  resolveEntryMicros,
  microsJsonForApi,
  withResolvedMicros,
  parseIngredientsJson,
  lowestConfidence,
};
