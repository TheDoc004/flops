const express = require('express');
const {
  parseIngredientsJson,
  normalizeIngredientsBody: normalizeIngredientsBodyShared,
} = require('../recipeIngredients');

function parseIngredientsColumn(raw) {
  return parseIngredientsJson(raw);
}

function parseMealBuilderMetaColumn(raw) {
  if (raw == null || raw === '') return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function normalizeIngredientsBody(body) {
  return normalizeIngredientsBodyShared(body);
}

function normalizeMealBuilderMetaBody(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'meal_builder_meta')) return { ok: true, value: undefined };
  const v = body.meal_builder_meta;
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'object') return { ok: false };
  return { ok: true, value: JSON.stringify(v) };
}

function normalizeRecipeKind(raw) {
  if (raw === null || raw === undefined || raw === '') return 'permanent';
  const s = String(raw).toLowerCase();
  return s === 'limited' ? 'limited' : 'permanent';
}

function normalizeLimitedUses(recipe_kind, rawRemaining, rawMax) {
  if (recipe_kind !== 'limited') {
    return { remaining_uses: null, max_uses: null };
  }
  const max = Number(rawMax);
  const rem = Number(rawRemaining);
  if (!Number.isInteger(max) || max < 1 || max > 999) {
    return { error: 'limited templates require max_uses as integer 1–999' };
  }
  if (!Number.isInteger(rem) || rem < 1 || rem > max) {
    return { error: 'limited templates require remaining_uses between 1 and max_uses' };
  }
  return { remaining_uses: rem, max_uses: max };
}

function rowToRecipe(row) {
  return {
    ...row,
    ingredients: parseIngredientsColumn(row.ingredients),
    meal_builder_meta: parseMealBuilderMetaColumn(row.meal_builder_meta),
    is_archived: row.is_archived ? 1 : 0,
  };
}

function createRecipesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
    const includeQuick = req.query.include_quick === '1' || req.query.include_quick === 'true';
    const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
    const clauses = [];
    if (!includeArchived) clauses.push('COALESCE(is_archived, 0) = 0');
    if (!includeQuick) clauses.push('COALESCE(is_quick_food, 0) = 0');
    if (!includeDeleted) clauses.push('COALESCE(is_deleted, 0) = 0');
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const recipes = db.prepare(`SELECT * FROM recipes${where} ORDER BY name`).all().map(rowToRecipe);
    res.json(recipes);
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Recipe not found' });
    res.json(rowToRecipe(row));
  });

  router.post('/', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const ing = normalizeIngredientsBody(req.body);
    if (!ing.ok) return res.status(400).json({ error: 'ingredients must be line items { name, amount } and/or variable slots' });
    const meta = normalizeMealBuilderMetaBody(req.body);
    if (!meta.ok) return res.status(400).json({ error: 'meal_builder_meta must be a JSON object or null' });

    const checkLi = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = 0');
    for (const item of ing.value) {
      if (item.kind === 'slot') {
        for (const lid of item.option_label_ingredient_ids) {
          if (!checkLi.get(lid)) {
            return res.status(400).json({ error: `Unknown label ingredient id: ${lid}` });
          }
        }
      }
    }

    const recipe_kind = normalizeRecipeKind(req.body.recipe_kind);
    const lim = normalizeLimitedUses(recipe_kind, req.body.remaining_uses ?? req.body.max_uses, req.body.max_uses);
    if (lim.error) return res.status(400).json({ error: lim.error });

    const is_archived =
      req.body.is_archived === true || req.body.is_archived === 1 || req.body.is_archived === '1' ? 1 : 0;

    const ingredientsJson = JSON.stringify(ing.value);
    const metaJson = meta.value === undefined ? null : meta.value;

    const result = db
      .prepare(
        `INSERT INTO recipes (
          name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
          recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        serving_size,
        Number(calories),
        Number(protein_g),
        Number(carbs_g),
        Number(fat_g),
        fiber_g != null ? Number(fiber_g) : null,
        ingredientsJson,
        recipe_kind,
        lim.remaining_uses,
        lim.max_uses,
        is_archived,
        metaJson
      );
    res.status(201).json(rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const existingRow = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
    if (!existingRow) return res.status(404).json({ error: 'Recipe not found' });

    let ingredientsJson;
    if (Object.prototype.hasOwnProperty.call(req.body, 'ingredients')) {
      const ing = normalizeIngredientsBody(req.body);
      if (!ing.ok) return res.status(400).json({ error: 'ingredients must be line items { name, amount } and/or variable slots' });
      const checkLi = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = 0');
      for (const item of ing.value) {
        if (item.kind === 'slot') {
          for (const lid of item.option_label_ingredient_ids) {
            if (!checkLi.get(lid)) {
              return res.status(400).json({ error: `Unknown label ingredient id: ${lid}` });
            }
          }
        }
      }
      ingredientsJson = JSON.stringify(ing.value);
    } else {
      ingredientsJson = existingRow.ingredients != null ? existingRow.ingredients : '[]';
    }

    let mealBuilderJson;
    if (Object.prototype.hasOwnProperty.call(req.body, 'meal_builder_meta')) {
      const meta = normalizeMealBuilderMetaBody(req.body);
      if (!meta.ok) return res.status(400).json({ error: 'meal_builder_meta must be a JSON object or null' });
      mealBuilderJson = meta.value === undefined ? existingRow.meal_builder_meta : meta.value;
    } else {
      mealBuilderJson = existingRow.meal_builder_meta;
    }

    const recipe_kind = Object.prototype.hasOwnProperty.call(req.body, 'recipe_kind')
      ? normalizeRecipeKind(req.body.recipe_kind)
      : existingRow.recipe_kind || 'permanent';

    let remaining_uses = existingRow.remaining_uses;
    let max_uses = existingRow.max_uses;
    if (recipe_kind === 'limited') {
      if (Object.prototype.hasOwnProperty.call(req.body, 'remaining_uses') || Object.prototype.hasOwnProperty.call(req.body, 'max_uses')) {
        const lim = normalizeLimitedUses(
          recipe_kind,
          req.body.remaining_uses ?? existingRow.remaining_uses,
          req.body.max_uses ?? existingRow.max_uses
        );
        if (lim.error) return res.status(400).json({ error: lim.error });
        remaining_uses = lim.remaining_uses;
        max_uses = lim.max_uses;
      }
    } else {
      remaining_uses = null;
      max_uses = null;
    }

    let is_archived = existingRow.is_archived;
    if (Object.prototype.hasOwnProperty.call(req.body, 'is_archived')) {
      is_archived =
        req.body.is_archived === true || req.body.is_archived === 1 || req.body.is_archived === '1' ? 1 : 0;
    }

    db.prepare(
      `UPDATE recipes SET name=?, serving_size=?, calories=?, protein_g=?, carbs_g=?, fat_g=?, fiber_g=?, ingredients=?,
        recipe_kind=?, remaining_uses=?, max_uses=?, is_archived=?, meal_builder_meta=?
       WHERE id=?`
    ).run(
      name,
      serving_size,
      Number(calories),
      Number(protein_g),
      Number(carbs_g),
      Number(fat_g),
      fiber_g != null ? Number(fiber_g) : null,
      ingredientsJson,
      recipe_kind,
      remaining_uses,
      max_uses,
      is_archived,
      mealBuilderJson,
      req.params.id
    );
    res.json(rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id)));
  });

  /** Reactivate an archived limited-use template (or bump uses). */
  router.post('/:id/reactivate', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Recipe not found' });
    const kind = row.recipe_kind || 'permanent';
    if (kind !== 'limited') {
      return res.status(400).json({ error: 'Only limited-use templates can be reactivated this way' });
    }
    const n = Number(req.body?.remaining_uses ?? req.body?.max_uses);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      return res.status(400).json({ error: 'remaining_uses (or max_uses) must be integer 1–999' });
    }
    db.prepare(
      `UPDATE recipes SET remaining_uses = ?, max_uses = ?, is_archived = 0 WHERE id = ?`
    ).run(n, n, id);
    res.json(rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id)));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    // Library delete: preserve historical logs by keeping recipes as soft-deleted templates.
    db.prepare('UPDATE recipes SET is_deleted = 1 WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });

  return router;
}

module.exports = { createRecipesRouter };
