const express = require('express');
const { uid } = require('../userId');
const { normalizeBarcode } = require('../openFoodFactsService');
const { buildMicrosBlob } = require('../microNutrients');
const { normalizeGramsPerServingInput } = require('../gramsPerServing');
const { scheduleIngredientMicrosCompletion } = require('../ingredientMicros');

/**
 * Micros supplied with an ingredient come off the manufacturer's panel (barcode
 * import), so they store at high confidence — the log route prefers them over
 * an AI estimate. Returns null when nothing usable was sent.
 */
function microsJsonFromBody(body) {
  const blob = buildMicrosBlob(body?.micros, { confidence: 'high', notes: 'From product label' });
  return blob ? JSON.stringify(blob) : null;
}

function normalizeOptionalNumber(v, { min = 0 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

function normalizeOptionalString(v, { maxLen = 64 } = {}) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeRequiredNumber(v, { min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

/**
 * The tracking type to store. An explicit, valid choice from the client always
 * wins. Otherwise it is DERIVED rather than defaulted: a body describing a
 * serving by unit ("1 scoop") with no grams per serving is unit-tracked, and
 * defaulting it to 'weight' produced rows that carried macros but could never
 * be logged, because weight scaling has nothing to divide by.
 */
function resolveTrackingType(body) {
  if (['weight', 'unit'].includes(body?.tracking_type)) return body.tracking_type;
  const { isUsableGramsPerServing } = require('../gramsPerServing');
  if (isUsableGramsPerServing(body?.grams_per_serving)) return 'weight';
  const hasUnitShape =
    (typeof body?.unit_name === 'string' && body.unit_name.trim()) ||
    Number(body?.serving_quantity) > 0;
  return hasUnitShape ? 'unit' : 'weight';
}

function createLabelIngredientsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = uid(req);
    const rows = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
                source_type, use_count, last_used_at, barcode, micros_json,
                tracking_type, unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml,
                CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
         FROM label_ingredients WHERE user_id = ? ORDER BY name`
      )
      .all(userId);
    res.json(rows);
  });

  router.get('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri,
                source_type, use_count, last_used_at, barcode, micros_json,
                tracking_type, unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml
         FROM label_ingredients WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.post('/', (req, res) => {
    const userId = uid(req);
    const name = String(req.body?.name ?? '').trim();
    const base_label = normalizeOptionalString(req.body?.base_label, { maxLen: 64 });
    const brand_name = normalizeOptionalString(req.body?.brand_name, { maxLen: 64 });
    const serving_size_text = String(req.body?.serving_size_text ?? '').trim();
    if (!name || !serving_size_text) {
      return res.status(400).json({ error: 'name and serving_size_text are required' });
    }
    const gpsNorm = normalizeGramsPerServingInput(req.body?.grams_per_serving);
    if (gpsNorm.error) return res.status(400).json({ error: gpsNorm.error });
    const grams_per_serving = gpsNorm.value;
    const calories = normalizeRequiredNumber(req.body?.calories);
    const protein_g = normalizeRequiredNumber(req.body?.protein_g);
    const carbs_g = normalizeRequiredNumber(req.body?.carbs_g);
    const fat_g = normalizeRequiredNumber(req.body?.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'calories, protein_g, carbs_g, fat_g must be valid non-negative numbers' });
    }
    const fiber_g = normalizeOptionalNumber(req.body?.fiber_g);
    const source_type = String(req.body?.source_type ?? '').trim() || 'manual';
    if (!['manual', 'scanned_label', 'built_in', 'barcode'].includes(source_type)) {
      return res.status(400).json({ error: 'source_type must be one of: manual, scanned_label, built_in, barcode' });
    }
    // Unusable barcodes are dropped rather than rejected — a bad code should
    // never block saving an otherwise-good ingredient.
    const barcode = normalizeBarcode(req.body?.barcode);
    const micros_json = microsJsonFromBody(req.body);
    let photo_data_uri = req.body?.photo_data_uri;
    if (photo_data_uri != null) {
      photo_data_uri = String(photo_data_uri);
      if (photo_data_uri.length > 400_000) {
        return res.status(400).json({ error: 'photo_data_uri too large (max ~400KB encoded)' });
      }
      if (photo_data_uri.trim() === '') photo_data_uri = null;
    }
    const tracking_type = resolveTrackingType(req.body);
    const unit_name = normalizeOptionalString(req.body?.unit_name, { maxLen: 64 });
    const serving_quantity = normalizeOptionalNumber(req.body?.serving_quantity, { min: 0.0001 });
    const grams_per_unit = normalizeOptionalNumber(req.body?.grams_per_unit, { min: 0.0001 });
    const servings_per_container = normalizeOptionalNumber(req.body?.servings_per_container, { min: 0.01 });
    const grams_per_ml = normalizeOptionalNumber(req.body?.grams_per_ml, { min: 0.1 });

    const r = db
      .prepare(
        `INSERT INTO label_ingredients (
          user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri,
          source_type, use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit, barcode, micros_json,
          servings_per_container, grams_per_ml
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        name,
        base_label,
        brand_name,
        serving_size_text,
        grams_per_serving,
        calories,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
        photo_data_uri ?? null,
        source_type,
        tracking_type,
        unit_name,
        serving_quantity,
        grams_per_unit,
        barcode,
        micros_json,
        servings_per_container,
        grams_per_ml
      );

    const row = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
                source_type, use_count, last_used_at, barcode, micros_json, tracking_type, unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml,
                CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
         FROM label_ingredients WHERE id = ?`
      )
      .get(r.lastInsertRowid);
    // Fill nutrients the label didn't list (or all of them, for a manual entry).
    scheduleIngredientMicrosCompletion(db, userId, r.lastInsertRowid);
    res.status(201).json(row);
  });

  router.put('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const name = String(req.body?.name ?? '').trim();
    const base_label = normalizeOptionalString(req.body?.base_label, { maxLen: 64 });
    const brand_name = normalizeOptionalString(req.body?.brand_name, { maxLen: 64 });
    const serving_size_text = String(req.body?.serving_size_text ?? '').trim();
    if (!name || !serving_size_text) {
      return res.status(400).json({ error: 'name and serving_size_text are required' });
    }
    const gpsNorm = normalizeGramsPerServingInput(req.body?.grams_per_serving);
    if (gpsNorm.error) return res.status(400).json({ error: gpsNorm.error });
    const grams_per_serving = gpsNorm.value;
    const calories = normalizeRequiredNumber(req.body?.calories);
    const protein_g = normalizeRequiredNumber(req.body?.protein_g);
    const carbs_g = normalizeRequiredNumber(req.body?.carbs_g);
    const fat_g = normalizeRequiredNumber(req.body?.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'calories, protein_g, carbs_g, fat_g must be valid non-negative numbers' });
    }
    const fiber_g = normalizeOptionalNumber(req.body?.fiber_g);
    const tracking_type = resolveTrackingType(req.body);
    const unit_name = normalizeOptionalString(req.body?.unit_name, { maxLen: 64 });
    const serving_quantity = normalizeOptionalNumber(req.body?.serving_quantity, { min: 0.0001 });
    const grams_per_unit = normalizeOptionalNumber(req.body?.grams_per_unit, { min: 0.0001 });
    const servings_per_container = normalizeOptionalNumber(req.body?.servings_per_container, { min: 0.01 });
    const grams_per_ml = normalizeOptionalNumber(req.body?.grams_per_ml, { min: 0.1 });
    // Only set when supplied (COALESCE below) — the edit form never sends a
    // barcode, and an edit must not wipe one an earlier scan attached.
    const barcode = normalizeBarcode(req.body?.barcode);
    // Same rule as barcode: absent means "leave what's stored", so editing an
    // ingredient's macros never silently drops its label micros.
    const micros_json = microsJsonFromBody(req.body);

    db.prepare(
      `UPDATE label_ingredients
       SET name = ?, base_label = ?, brand_name = ?, serving_size_text = ?, grams_per_serving = ?,
           calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
           tracking_type = ?, unit_name = ?, serving_quantity = ?, grams_per_unit = ?,
           servings_per_container = CASE WHEN ? THEN ? ELSE servings_per_container END,
           grams_per_ml = CASE WHEN ? THEN ? ELSE grams_per_ml END,
           barcode = COALESCE(?, barcode),
           micros_json = COALESCE(?, micros_json)
       WHERE id = ? AND user_id = ?`
    ).run(
      name,
      base_label,
      brand_name,
      serving_size_text,
      grams_per_serving,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      fiber_g,
      tracking_type,
      unit_name,
      serving_quantity,
      grams_per_unit,
      // Absent key keeps what's stored; an explicit null/"" clears it.
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'servings_per_container') ? 1 : 0,
      servings_per_container,
      // Same: the edit form doesn't know about density yet, so it must not wipe it.
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'grams_per_ml') ? 1 : 0,
      grams_per_ml,
      barcode,
      micros_json,
      id,
      userId
    );

    const row = db.prepare(
      `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
              source_type, use_count, last_used_at, barcode, micros_json, tracking_type, unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml,
              CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
       FROM label_ingredients WHERE id = ? AND user_id = ?`
    ).get(id, userId);
    scheduleIngredientMicrosCompletion(db, userId, id);
    res.json(row);
  });

  router.post('/used', (req, res) => {
    const userId = uid(req);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const clean = [...new Set(ids.map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0))];
    if (clean.length === 0) return res.status(400).json({ error: 'No valid ids' });

    const now = new Date().toISOString();
    const upd = db.prepare(
      `UPDATE label_ingredients
       SET use_count = COALESCE(use_count, 0) + 1,
           last_used_at = ?
       WHERE user_id = ? AND id = ?`
    );
    const run = db.transaction(() => {
      let changed = 0;
      for (const id of clean) {
        const r = upd.run(now, userId, id);
        changed += r.changes || 0;
      }
      return changed;
    });

    const changed = run();
    res.json({ updated: changed, ids: clean, last_used_at: now });
  });

  router.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const n = db.prepare('DELETE FROM label_ingredients WHERE id = ? AND user_id = ?').run(id, userId);
    if (n.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  return router;
}

module.exports = { createLabelIngredientsRouter };
