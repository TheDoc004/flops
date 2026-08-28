const express = require('express');
const { uid } = require('../userId');
const { rowToBatch } = require('../preppedBatchLib');

function num(v, { min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

function createPreppedBatchesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = uid(req);
    const includeDepleted = req.query.include_depleted === '1';
    const rows = db.prepare(
      `SELECT * FROM prepped_batches
       WHERE user_id = ? ${includeDepleted ? '' : 'AND is_depleted = 0'}
       ORDER BY created_at DESC`
    ).all(userId);
    res.json(rows.map(rowToBatch));
  });

  router.get('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM prepped_batches WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return res.status(404).json({ error: 'Prepped batch not found' });
    res.json(rowToBatch(row));
  });

  router.post('/', (req, res) => {
    const userId = uid(req);
    const name = String(req.body?.name ?? '').trim();
    const totalWeight = num(req.body?.total_weight_g, { min: 0.1 });
    const calories = num(req.body?.total_calories);
    const protein = num(req.body?.total_protein_g);
    const carbs = num(req.body?.total_carbs_g);
    const fat = num(req.body?.total_fat_g);
    const fiber = num(req.body?.total_fiber_g);
    const labelIngredientId = num(req.body?.label_ingredient_id, { min: 1 });

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (totalWeight == null) return res.status(400).json({ error: 'total_weight_g must be > 0' });
    if ([calories, protein, carbs, fat].some(v => v == null)) {
      return res.status(400).json({ error: 'total_calories, total_protein_g, total_carbs_g, total_fat_g required' });
    }

    if (labelIngredientId != null) {
      const li = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = ?').get(labelIngredientId, userId);
      if (!li) return res.status(400).json({ error: 'Unknown label_ingredient_id' });
    }

    const r = db.prepare(
      `INSERT INTO prepped_batches (
         user_id, name, total_weight_g, remaining_weight_g,
         total_calories, total_protein_g, total_carbs_g, total_fat_g, total_fiber_g,
         remaining_calories, remaining_protein_g, remaining_carbs_g, remaining_fat_g, remaining_fiber_g,
         label_ingredient_id, is_depleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      userId, name, totalWeight, totalWeight,
      calories, protein, carbs, fat, fiber ?? 0,
      calories, protein, carbs, fat, fiber ?? 0,
      labelIngredientId
    );
    const row = db.prepare('SELECT * FROM prepped_batches WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(rowToBatch(row));
  });

  router.post('/:id/deplete', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM prepped_batches WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return res.status(404).json({ error: 'Prepped batch not found' });
    db.prepare('UPDATE prepped_batches SET is_depleted = 1, remaining_weight_g = 0 WHERE id = ? AND user_id = ?').run(id, userId);
    res.json(rowToBatch(db.prepare('SELECT * FROM prepped_batches WHERE id = ?').get(id)));
  });

  return router;
}

module.exports = { createPreppedBatchesRouter };
