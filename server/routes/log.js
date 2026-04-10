const express = require('express');

const ENTRY_JOIN = `
  SELECT le.id, le.recipe_id, le.date, le.servings, le.notes,
         r.name AS recipe_name, r.serving_size,
         r.calories AS recipe_calories, r.protein_g AS recipe_protein_g,
         r.carbs_g AS recipe_carbs_g, r.fat_g AS recipe_fat_g,
         r.fiber_g AS recipe_fiber_g
  FROM log_entries le
  JOIN recipes r ON le.recipe_id = r.id
`;

function createLogRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { date, start, end } = req.query;
    if (date) {
      return res.json(db.prepare(`${ENTRY_JOIN} WHERE le.date = ? ORDER BY le.id`).all(date));
    }
    if (start && end) {
      return res.json(db.prepare(`${ENTRY_JOIN} WHERE le.date >= ? AND le.date <= ? ORDER BY le.date, le.id`).all(start, end));
    }
    res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?start=YYYY-MM-DD&end=YYYY-MM-DD' });
  });

  router.post('/', (req, res) => {
    const { recipe_id, date, servings, notes } = req.body;
    if (!recipe_id || !date || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, date, servings' });
    }
    if (!db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe_id)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    const result = db.prepare(
      'INSERT INTO log_entries (recipe_id, date, servings, notes) VALUES (?, ?, ?, ?)'
    ).run(recipe_id, date, Number(servings), notes ?? null);
    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(result.lastInsertRowid));
  });

  router.delete('/:id', (req, res) => {
    if (!db.prepare('SELECT id FROM log_entries WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Log entry not found' });
    }
    db.prepare('DELETE FROM log_entries WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });

  return router;
}

module.exports = { createLogRouter };
