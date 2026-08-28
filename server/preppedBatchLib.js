/**
 * Prepped batch pool — fixed total weight + macros, depletes on log.
 */

function r2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function rowToBatch(row) {
  if (!row) return null;
  return {
    ...row,
    is_depleted: row.is_depleted === 1,
  };
}

function macrosForBatchGrams(batch, gramsG) {
  const g = Number(gramsG);
  const rem = Number(batch.remaining_weight_g);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(rem) || rem <= 0) return null;
  if (g > rem + 1e-6) return null;
  const ratio = g / rem;
  return {
    grams: g,
    calories: r2(Number(batch.remaining_calories) * ratio),
    protein_g: r2(Number(batch.remaining_protein_g) * ratio),
    carbs_g: r2(Number(batch.remaining_carbs_g) * ratio),
    fat_g: r2(Number(batch.remaining_fat_g) * ratio),
    fiber_g: r2(Number(batch.remaining_fiber_g || 0) * ratio),
  };
}

function extractPreppedUsageFromRows(rows) {
  const usage = new Map();
  if (!Array.isArray(rows)) return usage;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const bid = Number(r.prepped_batch_id);
    if (!Number.isInteger(bid) || bid <= 0) continue;
    const unit = String(r.unit || 'g').toLowerCase();
    if (unit !== 'g') continue;
    const g = Number(r.amount);
    if (!Number.isFinite(g) || g <= 0) continue;
    usage.set(bid, (usage.get(bid) || 0) + g);
  }
  return usage;
}

function applyBatchDelta(db, userId, batchId, gramsDelta) {
  const delta = Number(gramsDelta);
  if (!Number.isFinite(delta) || delta === 0) return;
  const restoring = delta < 0;
  const batch = db.prepare(
    restoring
      ? 'SELECT * FROM prepped_batches WHERE id = ? AND user_id = ?'
      : 'SELECT * FROM prepped_batches WHERE id = ? AND user_id = ? AND is_depleted = 0'
  ).get(batchId, userId);
  if (!batch) {
    const err = new Error('PREPPED_BATCH_NOT_FOUND');
    err.code = 'PREPPED_BATCH_NOT_FOUND';
    throw err;
  }
  if (delta > 0) {
    const rem = Number(batch.remaining_weight_g);
    if (delta > rem + 1e-6) {
      const err = new Error('PREPPED_BATCH_EXHAUSTED');
      err.code = 'PREPPED_BATCH_EXHAUSTED';
      err.batchName = batch.name;
      throw err;
    }
    const ratio = delta / rem;
    const newRem = r2(rem - delta);
    const depleted = newRem <= 0 ? 1 : 0;
    db.prepare(
      `UPDATE prepped_batches SET
         remaining_weight_g = ?,
         remaining_calories = ?,
         remaining_protein_g = ?,
         remaining_carbs_g = ?,
         remaining_fat_g = ?,
         remaining_fiber_g = ?,
         is_depleted = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      Math.max(0, newRem),
      r2(Math.max(0, Number(batch.remaining_calories) * (1 - ratio))),
      r2(Math.max(0, Number(batch.remaining_protein_g) * (1 - ratio))),
      r2(Math.max(0, Number(batch.remaining_carbs_g) * (1 - ratio))),
      r2(Math.max(0, Number(batch.remaining_fat_g) * (1 - ratio))),
      r2(Math.max(0, Number(batch.remaining_fiber_g || 0) * (1 - ratio))),
      depleted,
      batchId,
      userId
    );
  } else {
    const restoreG = Math.abs(delta);
    const totalG = Number(batch.total_weight_g);
    const addMacros = restoreG / totalG;
    db.prepare(
      `UPDATE prepped_batches SET
         remaining_weight_g = MIN(total_weight_g, remaining_weight_g + ?),
         remaining_calories = MIN(total_calories, remaining_calories + ?),
         remaining_protein_g = MIN(total_protein_g, remaining_protein_g + ?),
         remaining_carbs_g = MIN(total_carbs_g, remaining_carbs_g + ?),
         remaining_fat_g = MIN(total_fat_g, remaining_fat_g + ?),
         remaining_fiber_g = MIN(total_fiber_g, remaining_fiber_g + ?),
         is_depleted = 0
       WHERE id = ? AND user_id = ?`
    ).run(
      restoreG,
      r2(Number(batch.total_calories) * addMacros),
      r2(Number(batch.total_protein_g) * addMacros),
      r2(Number(batch.total_carbs_g) * addMacros),
      r2(Number(batch.total_fat_g) * addMacros),
      r2(Number(batch.total_fiber_g || 0) * addMacros),
      batchId,
      userId
    );
  }
}

function applyUsageMap(db, userId, usageMap, sign) {
  for (const [batchId, grams] of usageMap.entries()) {
    applyBatchDelta(db, userId, batchId, sign * grams);
  }
}

function usageFromIngredientsJson(json) {
  if (!json) return new Map();
  let rows;
  try {
    rows = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return new Map();
  }
  return extractPreppedUsageFromRows(rows);
}

module.exports = {
  rowToBatch,
  macrosForBatchGrams,
  extractPreppedUsageFromRows,
  applyBatchDelta,
  applyUsageMap,
  usageFromIngredientsJson,
};
