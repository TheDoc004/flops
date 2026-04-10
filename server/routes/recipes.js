const express = require('express');

function createRecipesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const recipes = db.prepare('SELECT * FROM recipes ORDER BY name').all();
    res.json(recipes);
  });

  router.post('/', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const result = db.prepare(
      'INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name, serving_size, Number(calories), Number(protein_g), Number(carbs_g), Number(fat_g), fiber_g != null ? Number(fiber_g) : null);
    res.status(201).json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    db.prepare(
      'UPDATE recipes SET name=?, serving_size=?, calories=?, protein_g=?, carbs_g=?, fat_g=?, fiber_g=? WHERE id=?'
    ).run(name, serving_size, Number(calories), Number(protein_g), Number(carbs_g), Number(fat_g), fiber_g != null ? Number(fiber_g) : null, req.params.id);
    res.json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    const hasLogs = db.prepare('SELECT id FROM log_entries WHERE recipe_id = ? LIMIT 1').get(req.params.id);
    if (hasLogs) {
      return res.status(409).json({ error: 'This recipe has logged meals. Delete those log entries first before removing the recipe.' });
    }
    db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });

  return router;
}

module.exports = { createRecipesRouter };
