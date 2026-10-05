#!/usr/bin/env node
/**
 * One-time move of the gram weight on UNIT-tracked ingredients from the stray
 * grams_per_serving column into grams_per_unit — the only gram weight the app
 * (unitConvert, micros, the edit modal) reads for those rows.
 *
 *   grams_per_unit    = grams_per_serving / serving_quantity   (grams in ONE unit)
 *   grams_per_serving = NULL
 *
 * Touches only rows with tracking_type='unit', no grams_per_unit, and a
 * positive grams_per_serving. Placeholder weights below MIN_GRAMS_PER_SERVING
 * (the 1 g stand-ins) are never moved — they'd become "1 slice = 1 g".
 * Macros and micros are never changed.
 *
 * Dry run (default) prints the rows. --apply writes them in one transaction
 * and saves a JSON backup of the old values next to the DB for undo.
 *   node scripts/migrateUnitGramsPerUnit.js [--apply] [--skip=86,22] [--db=path]
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { MIN_GRAMS_PER_SERVING } = require('../gramsPerServing');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skip = new Set(
  (args.find(a => a.startsWith('--skip=')) || '--skip=')
    .slice(7).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
);
const dbPath = (args.find(a => a.startsWith('--db=')) || '').slice(5)
  || process.env.DB_PATH || path.join(__dirname, '..', 'nutrition.db');

const MASS_UNITS = new Set(['g', 'gram', 'grams', 'oz', 'ounce', 'ounces', 'kg', 'lb', 'lbs']);

function candidates(db) {
  return db
    .prepare(
      `SELECT id, user_id, name, brand_name, serving_size_text, unit_name, serving_quantity,
              grams_per_serving, grams_per_unit, calories
         FROM label_ingredients
        WHERE tracking_type = 'unit'
          AND (grams_per_unit IS NULL OR grams_per_unit <= 0)
          AND grams_per_serving > 0
        ORDER BY id`
    )
    .all()
    .filter(r => !MASS_UNITS.has(String(r.unit_name || '').trim().toLowerCase()))
    .map(r => {
      const qty = Number(r.serving_quantity) > 0 ? Number(r.serving_quantity) : 1;
      const gpu = Math.round((r.grams_per_serving / qty) * 1000) / 1000;
      const kcalPer100g = r.grams_per_serving > 0 ? (r.calories / r.grams_per_serving) * 100 : null;
      const flags = [];
      if (kcalPer100g != null && kcalPer100g > 900) flags.push(`${Math.round(kcalPer100g)} kcal/100g > 900`);
      if (!(Number(r.serving_quantity) > 0)) flags.push('no serving_quantity (assumed 1)');
      const placeholder = r.grams_per_serving < MIN_GRAMS_PER_SERVING;
      if (placeholder) flags.push(`placeholder ${r.grams_per_serving} g — left alone`);
      return { ...r, new_grams_per_unit: gpu, kcal_per_100g: kcalPer100g, flags, skipped: skip.has(r.id) || placeholder };
    });
}

function main() {
  const db = new Database(dbPath, { readonly: !apply });
  const rows = candidates(db);
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${dbPath} — ${rows.length} candidate row(s)\n`);
  console.table(rows.map(r => ({
    id: r.id,
    name: r.brand_name ? `${r.name} (${r.brand_name})` : r.name,
    serving: r.serving_size_text,
    unit: r.unit_name,
    qty: r.serving_quantity,
    gps_now: r.grams_per_serving,
    new_gpu: r.new_grams_per_unit,
    kcal_100g: r.kcal_per_100g == null ? null : Math.round(r.kcal_per_100g),
    flags: r.flags.join('; '),
    skip: r.skipped ? 'SKIP' : '',
  })));

  const todo = rows.filter(r => !r.skipped);
  if (!apply) {
    console.log(`\nNothing written. Re-run with --apply (and --skip=ids to leave rows for manual fixing).`);
    return;
  }
  const backup = path.join(path.dirname(dbPath), `unit-gpu-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(todo.map(r => ({
    id: r.id, grams_per_serving: r.grams_per_serving, grams_per_unit: r.grams_per_unit,
  })), null, 2));
  const upd = db.prepare(
    'UPDATE label_ingredients SET grams_per_unit = ?, grams_per_serving = NULL WHERE id = ? AND tracking_type = \'unit\''
  );
  const n = db.transaction(() => todo.reduce((acc, r) => acc + upd.run(r.new_grams_per_unit, r.id).changes, 0))();
  console.log(`\nUpdated ${n} row(s). Backup of old values: ${backup}`);
}

if (require.main === module) main();

module.exports = { candidates };
