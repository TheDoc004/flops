/**
 * Body-weight writes, shared by PUT /api/body-weights and the MCP
 * log_body_weight tool so both store a weigh-in identically.
 *
 * One row per (user, date), stored in kg. A second weigh-in for a date
 * OVERWRITES the first — that is what the Dashboard has always done.
 */

/** Same constant as client/src/shared/utils/bodyUnits.js — lb ÷ 2.20462 = kg. */
const LB_PER_KG = 2.20462;

function getBodyWeight(db, userId, date) {
  return db
    .prepare(`SELECT date, weight_kg, COALESCE(source, 'app') AS source FROM body_weights WHERE user_id = ? AND date = ?`)
    .get(userId, date) || null;
}

/** Upsert one date's weigh-in. Returns { before, after } (before null when new). */
function upsertBodyWeight(db, userId, date, weightKg, source = 'app') {
  const before = getBodyWeight(db, userId, date);
  db.prepare(`
    INSERT INTO body_weights (user_id, date, weight_kg, source) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, source = excluded.source
  `).run(userId, date, weightKg, source);
  return { before, after: getBodyWeight(db, userId, date) };
}

module.exports = { LB_PER_KG, getBodyWeight, upsertBodyWeight };
