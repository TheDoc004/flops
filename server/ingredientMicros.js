/**
 * ingredientMicros — give every library ingredient a FULL micronutrient set.
 *
 * Meal micros are summed live from each ingredient's stored micros_json
 * (entryMicros), so an ingredient with no blob counts as zero, and one whose
 * blob came off a US label carries only the handful of nutrients the panel
 * prints (sodium, calcium, iron, potassium, vitamin D) — the other two dozen
 * read as zero too. This module fills those gaps once per ingredient with an
 * AI estimate for ONE stored serving.
 *
 * Rules:
 *   - A nutrient already stored is never overwritten — label values stay exact.
 *   - Only absent nutrients are filled; their keys are recorded in
 *     `filled_keys` so it is always clear which numbers are estimates.
 *   - Filling anything caps confidence at medium.
 *   - `completed_at` marks the blob done, so each ingredient costs one AI call.
 *     Any write that replaces micros_json drops the marker, and the new blob is
 *     completed again.
 */

const { MICRO_KEYS, buildMicrosBlob } = require('./microNutrients');
const { estimateMicrosFromIngredients } = require('./microEstimateService');

function parseBlob(micros_json) {
  if (!micros_json) return null;
  try {
    const p = typeof micros_json === 'string' ? JSON.parse(micros_json) : micros_json;
    return p && typeof p === 'object' && p.micros && typeof p.micros === 'object' ? p : null;
  } catch {
    return null;
  }
}

/** Stored nutrient keys (a stored 0 is a measured zero, not a gap). */
function presentKeys(blob) {
  if (!blob) return [];
  return MICRO_KEYS.filter(k => {
    const v = blob.micros[k];
    return v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  });
}

/** True when the ingredient needs no estimate: already completed, or every key stored. */
function isComplete(micros_json) {
  const blob = parseBlob(micros_json);
  if (!blob) return false;
  if (blob.completed_at) return true;
  return presentKeys(blob).length === MICRO_KEYS.length;
}

function fmt(n) {
  return Math.round(Number(n) * 10) / 10;
}

/**
 * One stored serving as an estimator row. Macros go in the name: they anchor
 * the estimate to THIS product's serving (a "fillet" or "slice" is otherwise a
 * guess) and to its fat content (omega-3s can't exceed the fat).
 *
 * A weighed serving is asked about as 100 g, with macros per 100 g, and the
 * answer is scaled back by `scale`. Asked for "28 g feta" or "85 g spinach",
 * the model handed back food-table values per 100 g as if they were the
 * serving — phosphorus and potassium 3–6× too high — because per 100 g is the
 * basis it actually remembers. Asking in that basis removes the mismatch.
 */
function servingLine(ing) {
  const brand = ing.brand_name ? ` (${ing.brand_name})` : '';
  const gps = Number(ing.grams_per_serving);
  const per100 = ing.tracking_type !== 'unit' && gps > 0;
  const k = per100 ? 100 / gps : 1;
  const macros =
    `${per100 ? 'per 100 g' : 'per serving'}: ${fmt(ing.calories * k)} kcal, ${fmt(ing.protein_g * k)} g protein, ` +
    `${fmt(ing.carbs_g * k)} g carbs, ${fmt(ing.fat_g * k)} g fat` +
    (Number(ing.fiber_g) > 0 ? `, ${fmt(ing.fiber_g * k)} g fiber` : '');
  const name = `${ing.name}${brand} — ${macros}`;

  if (per100) return { name, amount: 100, unit: 'g', scale: gps / 100 };

  const qty = Number(ing.serving_quantity) > 0 ? Number(ing.serving_quantity) : 1;
  const unit = String(ing.unit_name || '').trim() || 'serving';
  const gpu = Number(ing.grams_per_unit);
  return gpu > 0
    ? { name: `${name}; 1 ${unit} ≈ ${fmt(gpu)} g`, amount: qty, unit }
    : { name: `${name}; serving described as "${ing.serving_size_text || `${qty} ${unit}`}"`, amount: qty, unit };
}

/** Estimate for 100 g -> estimate for the stored serving. */
function scaleEstimate(estimated, scale) {
  if (!estimated?.micros || !(scale > 0) || scale === 1) return estimated;
  const micros = {};
  for (const [key, v] of Object.entries(estimated.micros)) {
    const n = Number(v);
    micros[key] = Number.isFinite(n) ? Math.round(n * scale * 1000) / 1000 : v;
  }
  return { ...estimated, micros };
}

/**
 * Stored blob + estimate -> completed blob. Stored keys win; estimated keys
 * fill only what is absent.
 */
function completeBlob(stored, estimated) {
  const present = new Set(presentKeys(stored));
  const merged = {};
  const filled = [];
  for (const k of MICRO_KEYS) {
    if (present.has(k)) {
      merged[k] = Number(stored.micros[k]);
      continue;
    }
    const v = Number(estimated?.micros?.[k]);
    if (Number.isFinite(v) && v >= 0) {
      merged[k] = v;
      filled.push(k);
    }
  }

  let confidence;
  let notes;
  if (!stored) {
    confidence = estimated?.confidence === 'low' ? 'low' : 'medium';
    notes = 'Estimated per serving';
  } else {
    confidence = filled.length && stored.confidence === 'high' ? 'medium' : stored.confidence;
    const base = stored.notes || 'Stored values';
    notes = filled.length ? `${base}; ${filled.length} missing nutrients estimated` : base;
  }

  const blob = buildMicrosBlob(merged, { confidence, notes });
  if (!blob) return null;
  blob.filled_keys = filled;
  blob.completed_at = new Date().toISOString();
  return blob;
}

/**
 * Fill one ingredient's missing nutrients. Best-effort: resolves to a status
 * string and never throws.
 *
 * @param {object} [opts]
 * @param {Function} [opts.estimate] injectable estimator (tests)
 * @returns {Promise<'completed'|'skipped'|'failed'>}
 */
async function completeIngredientMicros(db, userId, id, { estimate = estimateMicrosFromIngredients } = {}) {
  try {
    const select = db.prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
              tracking_type, unit_name, serving_quantity, grams_per_unit, micros_json
         FROM label_ingredients WHERE id = ? AND user_id = ?`
    );
    const ing = select.get(id, userId);
    if (!ing || isComplete(ing.micros_json)) return 'skipped';

    const line = servingLine(ing);
    const estimated = scaleEstimate(await estimate([line]), line.scale);
    if (!estimated?.micros) return 'failed';

    // Re-read: the row may have been edited while the estimate was in flight.
    const now = select.get(id, userId);
    if (!now || now.micros_json !== ing.micros_json) return 'skipped';

    const blob = completeBlob(parseBlob(now.micros_json), estimated);
    if (!blob) return 'failed';
    db.prepare('UPDATE label_ingredients SET micros_json = ? WHERE id = ? AND user_id = ? AND micros_json IS ?')
      .run(JSON.stringify(blob), id, userId, now.micros_json);
    return 'completed';
  } catch {
    return 'failed';
  }
}

/**
 * Fire-and-forget completion after an ingredient is created or edited. Off in
 * tests: they exercise completeIngredientMicros directly, and a background AI
 * call must not outlive a test's database.
 */
function scheduleIngredientMicrosCompletion(db, userId, id) {
  if (process.env.NODE_ENV === 'test') return;
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) return;
  setImmediate(() => {
    completeIngredientMicros(db, userId, Number(id)).catch(() => {});
  });
}

/**
 * Complete every incomplete ingredient, one at a time (boot backfill). Stops
 * early when the estimator keeps failing — usually no AI provider configured.
 */
async function backfillIngredientMicros(db, { estimate = estimateMicrosFromIngredients, log = () => {} } = {}) {
  const rows = db.prepare('SELECT id, user_id, micros_json FROM label_ingredients ORDER BY id').all();
  const todo = rows.filter(r => !isComplete(r.micros_json));
  const counts = { completed: 0, skipped: 0, failed: 0, pending: todo.length };
  let failStreak = 0;
  for (const r of todo) {
    const status = await completeIngredientMicros(db, r.user_id, r.id, { estimate });
    counts[status] += 1;
    failStreak = status === 'failed' ? failStreak + 1 : 0;
    if (failStreak >= 3) {
      log(`ingredient micros backfill: stopping after ${failStreak} failures in a row`);
      break;
    }
  }
  log(`ingredient micros backfill: ${JSON.stringify(counts)}`);
  return counts;
}

module.exports = {
  isComplete,
  servingLine,
  scaleEstimate,
  completeBlob,
  completeIngredientMicros,
  scheduleIngredientMicrosCompletion,
  backfillIngredientMicros,
};
