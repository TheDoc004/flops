const express = require('express');

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

function createLabelIngredientsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const rows = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
                source_type, use_count, last_used_at,
                tracking_type, unit_name, serving_quantity, grams_per_unit,
                CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
         FROM label_ingredients WHERE user_id = ? ORDER BY name`
      )
      .all(userId);
    res.json(rows);
  });

  router.get('/:id', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri,
                source_type, use_count, last_used_at,
                tracking_type, unit_name, serving_quantity, grams_per_unit
         FROM label_ingredients WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.post('/', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const name = String(req.body?.name ?? '').trim();
    const base_label = normalizeOptionalString(req.body?.base_label, { maxLen: 64 });
    const brand_name = normalizeOptionalString(req.body?.brand_name, { maxLen: 64 });
    const serving_size_text = String(req.body?.serving_size_text ?? '').trim();
    if (!name || !serving_size_text) {
      return res.status(400).json({ error: 'name and serving_size_text are required' });
    }
    const grams_per_serving = normalizeOptionalNumber(req.body?.grams_per_serving, { min: 0.0001 });
    const calories = normalizeRequiredNumber(req.body?.calories);
    const protein_g = normalizeRequiredNumber(req.body?.protein_g);
    const carbs_g = normalizeRequiredNumber(req.body?.carbs_g);
    const fat_g = normalizeRequiredNumber(req.body?.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'calories, protein_g, carbs_g, fat_g must be valid non-negative numbers' });
    }
    const fiber_g = normalizeOptionalNumber(req.body?.fiber_g);
    const source_type = String(req.body?.source_type ?? '').trim() || 'manual';
    if (!['manual', 'scanned_label', 'built_in'].includes(source_type)) {
      return res.status(400).json({ error: 'source_type must be one of: manual, scanned_label, built_in' });
    }
    let photo_data_uri = req.body?.photo_data_uri;
    if (photo_data_uri != null) {
      photo_data_uri = String(photo_data_uri);
      if (photo_data_uri.length > 400_000) {
        return res.status(400).json({ error: 'photo_data_uri too large (max ~400KB encoded)' });
      }
      if (photo_data_uri.trim() === '') photo_data_uri = null;
    }
    const tracking_type = ['weight', 'unit'].includes(req.body?.tracking_type) ? req.body.tracking_type : 'weight';
    const unit_name = normalizeOptionalString(req.body?.unit_name, { maxLen: 64 });
    const serving_quantity = normalizeOptionalNumber(req.body?.serving_quantity, { min: 0.0001 });
    const grams_per_unit = normalizeOptionalNumber(req.body?.grams_per_unit, { min: 0.0001 });

    const r = db
      .prepare(
        `INSERT INTO label_ingredients (
          user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri,
          source_type, use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`
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
        grams_per_unit
      );

    const row = db
      .prepare(
        `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
                source_type, use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit,
                CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
         FROM label_ingredients WHERE id = ?`
      )
      .get(r.lastInsertRowid);
    res.status(201).json(row);
  });

  router.put('/:id', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 0) return res.status(400).json({ error: 'Invalid user_id' });
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
    const grams_per_serving = normalizeOptionalNumber(req.body?.grams_per_serving, { min: 0.0001 });
    const calories = normalizeRequiredNumber(req.body?.calories);
    const protein_g = normalizeRequiredNumber(req.body?.protein_g);
    const carbs_g = normalizeRequiredNumber(req.body?.carbs_g);
    const fat_g = normalizeRequiredNumber(req.body?.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'calories, protein_g, carbs_g, fat_g must be valid non-negative numbers' });
    }
    const fiber_g = normalizeOptionalNumber(req.body?.fiber_g);
    const tracking_type = ['weight', 'unit'].includes(req.body?.tracking_type) ? req.body.tracking_type : 'weight';
    const unit_name = normalizeOptionalString(req.body?.unit_name, { maxLen: 64 });
    const serving_quantity = normalizeOptionalNumber(req.body?.serving_quantity, { min: 0.0001 });
    const grams_per_unit = normalizeOptionalNumber(req.body?.grams_per_unit, { min: 0.0001 });

    db.prepare(
      `UPDATE label_ingredients
       SET name = ?, base_label = ?, brand_name = ?, serving_size_text = ?, grams_per_serving = ?,
           calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
           tracking_type = ?, unit_name = ?, serving_quantity = ?, grams_per_unit = ?
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
      id,
      userId
    );

    const row = db.prepare(
      `SELECT id, user_id, name, base_label, brand_name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
              source_type, use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit,
              CASE WHEN photo_data_uri IS NOT NULL AND LENGTH(photo_data_uri) > 0 THEN 1 ELSE 0 END AS has_photo
       FROM label_ingredients WHERE id = ? AND user_id = ?`
    ).get(id, userId);
    res.json(row);
  });

  router.post('/used', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
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
    const userId = Number(req.query.user_id ?? 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const n = db.prepare('DELETE FROM label_ingredients WHERE id = ? AND user_id = ?').run(id, userId);
    if (n.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  return router;
}

module.exports = { createLabelIngredientsRouter };
