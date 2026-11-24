#!/usr/bin/env node
/**
 * READ-ONLY audit: find MCP food updates that changed an ingredient's gram
 * weight but left micros_json untouched. micros_json is stored per label
 * serving, so those micros were silently reinterpreted against the new
 * serving (100 g -> 30 g made every micro 3.33x per gram).
 *
 * Walks mcp_write_audit: single update_food_item rows (before_json/after_json)
 * and the update_food_item steps inside write_batch rows (response_json.results).
 * For each hit it reports the factor the micros are off by, and whether the
 * ingredient still carries that same blob today (if not, it was fixed since).
 *
 * App edits (PUT /api/label-ingredients/:id) are not audited, so they can't be
 * found here.
 *
 *   node scripts/auditUnscaledMicros.js [--db=path] [--json]
 */
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dbPath = (args.find(a => a.startsWith('--db=')) || '').slice(5)
  || process.env.DB_PATH || path.join(__dirname, '..', 'nutrition.db');

function parseJson(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** [{ audit_id, created_at, reverted_at, step, before, after }] for every food update. */
function foodUpdateSteps(db) {
  const rows = db.prepare(
    `SELECT id, user_id, op, kind, created_at, reverted_at, before_json, after_json, response_json
       FROM mcp_write_audit
      WHERE COALESCE(op, kind) IN ('update_food_item', 'write_batch')
      ORDER BY id`
  ).all();
  const steps = [];
  for (const r of rows) {
    const base = { audit_id: r.id, user_id: r.user_id, created_at: r.created_at, reverted_at: r.reverted_at || null };
    if ((r.op || r.kind) === 'update_food_item') {
      steps.push({ ...base, step: null, before: parseJson(r.before_json), after: parseJson(r.after_json) });
      continue;
    }
    const results = parseJson(r.response_json)?.results || [];
    results.forEach((res, i) => {
      if (res?.op === 'update_food_item') steps.push({ ...base, step: i, before: res.before, after: res.after });
    });
  }
  return steps;
}

function main() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const current = db.prepare(
    'SELECT id, name, tracking_type, grams_per_serving, micros_json FROM label_ingredients WHERE id = ? AND user_id = ?'
  );
  const hits = [];
  for (const s of foodUpdateSteps(db)) {
    const b = s.before;
    const a = s.after;
    if (!b || !a) continue;
    if (b.grams_per_serving === a.grams_per_serving) continue;
    if (!b.micros_json || b.micros_json !== a.micros_json) continue;
    const now = current.get(a.id ?? b.id, s.user_id);
    const oldG = Number(b.grams_per_serving);
    const newG = Number(a.grams_per_serving);
    hits.push({
      audit_id: s.audit_id,
      batch_step: s.step,
      created_at: s.created_at,
      reverted_at: s.reverted_at,
      label_ingredient_id: a.id ?? b.id,
      name: now?.name ?? a.name,
      tracking_type: a.tracking_type,
      grams_per_serving: { before: b.grams_per_serving ?? null, after: a.grams_per_serving ?? null },
      // Per-gram micros are inflated by this factor (old grams / new grams).
      per_gram_factor: oldG > 0 && newG > 0 ? Math.round((oldG / newG) * 1000) / 1000 : null,
      still_same_blob: !!now && now.micros_json === a.micros_json,
      current_grams_per_serving: now?.grams_per_serving ?? null,
    });
  }
  db.close();

  if (asJson) {
    console.log(JSON.stringify(hits, null, 2));
    return;
  }
  console.log(`DB: ${dbPath}`);
  console.log(`${hits.length} food update(s) changed grams_per_serving without touching micros_json.\n`);
  for (const h of hits) {
    const where = h.batch_step == null ? `audit #${h.audit_id}` : `audit #${h.audit_id} step ${h.batch_step}`;
    const status = h.reverted_at ? 'REVERTED' : h.still_same_blob ? 'STILL AFFECTED' : 'micros changed since';
    console.log(
      `#${h.label_ingredient_id} ${h.name} [${h.tracking_type}] — ${where}, ${h.created_at}\n` +
      `   grams_per_serving ${h.grams_per_serving.before} -> ${h.grams_per_serving.after}` +
      (h.per_gram_factor != null ? `, per-gram micros x${h.per_gram_factor}` : ', factor unknown (null/placeholder grams)') +
      ` — ${status}`
    );
  }
}

main();
