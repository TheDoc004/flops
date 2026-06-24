const express = require('express');
const {
  adjustPerServingMacrosForResolvedSlots,
  resolveSlotsForLog,
  listVariableSlotsFromRecipeRow,
} = require('../recipeIngredients');
const { MICRO_KEYS, MICRO_ESTIMATE_VERSION } = require('../microNutrients');

/**
 * Build the structured micronutrient blob to store on a log entry, or null.
 * Only known keys with finite non-negative values are kept (req 13: store
 * structured values only, not raw AI responses).
 */
function normalizeMicrosPayload(body) {
  const m = body && typeof body.micros === 'object' ? body.micros : null;
  if (!m) return null;
  const micros = {};
  for (const k of MICRO_KEYS) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v >= 0) micros[k] = Math.round(v * 100) / 100;
  }
  // A meal only counts as estimated if at least one nutrient is actually > 0.
  // An empty or all-zero object is not a real estimate — don't store it.
  if (!Object.values(micros).some(v => v > 0)) return null;
  const confidence = ['low', 'medium', 'high'].includes(body.micros_confidence) ? body.micros_confidence : 'low';
  const notes = body.micros_notes != null ? String(body.micros_notes).slice(0, 500) : '';
  return JSON.stringify({
    micros,
    confidence,
    notes,
    version: MICRO_ESTIMATE_VERSION,
    estimatedAt: new Date().toISOString(),
  });
}

const ENTRY_JOIN = `
  SELECT le.id, le.recipe_id, le.date, le.time_min, le.servings, le.notes,
         le.slot_selections_json, le.micros_json,
         COALESCE(le.recipe_name, r.name, 'Deleted recipe') AS recipe_name,
         COALESCE(le.serving_size, r.serving_size, '') AS serving_size,
         COALESCE(le.recipe_calories, r.calories, 0) AS recipe_calories,
         COALESCE(le.recipe_protein_g, r.protein_g, 0) AS recipe_protein_g,
         COALESCE(le.recipe_carbs_g, r.carbs_g, 0) AS recipe_carbs_g,
         COALESCE(le.recipe_fat_g, r.fat_g, 0) AS recipe_fat_g,
         COALESCE(le.recipe_fiber_g, r.fiber_g) AS recipe_fiber_g,
         COALESCE(le.recipe_is_quick_food, r.is_quick_food, 0) AS recipe_is_quick_food
  FROM log_entries le
  LEFT JOIN recipes r ON le.recipe_id = r.id
`;

function mapSlotAdjustError(e) {
  if (!e || !e.code) return 'Could not calculate meal macros.';
  if (e.code === 'INVALID_SLOT_SELECTION') return 'Invalid ingredient choice for a variable slot.';
  if (e.code === 'INVALID_LOG_SLOT_CUSTOMIZATION') return 'Invalid log-time ingredient customization.';
  if (e.code === 'INVALID_SLOT_AMOUNT') return 'Invalid amount on a recipe variable slot.';
  if (e.code === 'LABEL_INGREDIENT_NOT_FOUND') return 'A selected ingredient was not found in your library.';
  if (e.code === 'LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING') {
    return 'An ingredient needs grams per serving to calculate macros. Edit it in Ingredient Library.';
  }
  return e.message || 'Could not calculate meal macros.';
}

function normalizeTimeMin(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 0 || i > 1439) return null;
  return i;
}

function createLogRouter(db) {
  const router = express.Router();

  function normalizeIsoDate(raw) {
    if (!raw || typeof raw !== 'string') return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  }

  function normalizeNonNegNumber(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  router.post('/quick-food', (req, res) => {
    const date = normalizeIsoDate(req.body?.date);
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const unit = req.body?.unit === 'oz' ? 'oz' : 'g';
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const calories_100g = normalizeNonNegNumber(req.body?.calories_100g);
    const protein_g_100g = normalizeNonNegNumber(req.body?.protein_g_100g);
    const carbs_g_100g = normalizeNonNegNumber(req.body?.carbs_g_100g);
    const fat_g_100g = normalizeNonNegNumber(req.body?.fat_g_100g);
    if (calories_100g == null || protein_g_100g == null || carbs_g_100g == null || fat_g_100g == null) {
      return res.status(400).json({ error: 'calories_100g, protein_g_100g, carbs_g_100g, fat_g_100g must be non-negative numbers' });
    }

    const grams = unit === 'oz' ? amount * 28.349523125 : amount;
    const servings = grams / 100;
    if (!Number.isFinite(servings) || servings <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const t = normalizeTimeMin(req.body?.time_min);
    const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;

    const findExisting = db.prepare(
      `SELECT id FROM recipes
       WHERE COALESCE(is_quick_food, 0) = 1 AND lower(name) = lower(?) AND serving_size = '100 g'
       ORDER BY id ASC LIMIT 1`
    );
    const updateExisting = db.prepare(
      `UPDATE recipes
       SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = NULL, ingredients = '[]', recipe_kind = 'permanent', is_archived = 0, meal_builder_meta = NULL, is_quick_food = 1
       WHERE id = ?`
    );
    const insertRecipe = db.prepare(
      `INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food)
       VALUES (?, '100 g', ?, ?, ?, ?, NULL, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    );
    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );

    let entryId;
    try {
      const run = db.transaction(() => {
        const existing = findExisting.get(name);
        let recipeId;
        if (existing?.id) {
          recipeId = existing.id;
          updateExisting.run(calories_100g, protein_g_100g, carbs_g_100g, fat_g_100g, recipeId);
        } else {
          const r = insertRecipe.run(name, calories_100g, protein_g_100g, carbs_g_100g, fat_g_100g);
          recipeId = r.lastInsertRowid;
        }
        const ins = insertLog.run(
          recipeId,
          date,
          t,
          servings,
          notes || null,
          name,
          '100 g',
          calories_100g,
          protein_g_100g,
          carbs_g_100g,
          fat_g_100g,
          null,
          1
        );
        return ins.lastInsertRowid;
      });
      entryId = run();
    } catch (e) {
      return res.status(500).json({ error: 'Failed to quick-log food' });
    }

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(entryId));
  });

  /**
   * Log a one-off meal from absolute (per-serving) macros — e.g. macros worked
   * out elsewhere and pasted in. Like quick-food, this writes to a hidden
   * (is_quick_food=1) backing recipe so it appears in the daily log/history but
   * NEVER in the Recipe Library. Deduped by name so repeats don't pile up.
   */
  router.post('/custom', (req, res) => {
    const date = normalizeIsoDate(req.body?.date);
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const calories = normalizeNonNegNumber(req.body?.calories);
    const protein_g = normalizeNonNegNumber(req.body?.protein_g);
    const carbs_g = normalizeNonNegNumber(req.body?.carbs_g);
    const fat_g = normalizeNonNegNumber(req.body?.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'calories, protein_g, carbs_g, fat_g must be non-negative numbers' });
    }
    const fiber_g = req.body?.fiber_g == null || req.body?.fiber_g === '' ? null : normalizeNonNegNumber(req.body?.fiber_g);
    if (req.body?.fiber_g != null && req.body?.fiber_g !== '' && fiber_g == null) {
      return res.status(400).json({ error: 'fiber_g must be a non-negative number' });
    }

    const servingsRaw = req.body?.servings == null ? 1 : Number(req.body.servings);
    if (!Number.isFinite(servingsRaw) || servingsRaw <= 0) {
      return res.status(400).json({ error: 'servings must be a positive number' });
    }

    const t = normalizeTimeMin(req.body?.time_min);
    const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;

    const findExisting = db.prepare(
      `SELECT id FROM recipes
       WHERE COALESCE(is_quick_food, 0) = 1 AND lower(name) = lower(?) AND serving_size = '1 serving'
       ORDER BY id ASC LIMIT 1`
    );
    const updateExisting = db.prepare(
      `UPDATE recipes
       SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, ingredients = '[]', recipe_kind = 'permanent', is_archived = 0, meal_builder_meta = NULL, is_quick_food = 1
       WHERE id = ?`
    );
    const insertRecipe = db.prepare(
      `INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food)
       VALUES (?, '1 serving', ?, ?, ?, ?, ?, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    );
    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );

    let entryId;
    try {
      const run = db.transaction(() => {
        const existing = findExisting.get(name);
        let recipeId;
        if (existing?.id) {
          recipeId = existing.id;
          updateExisting.run(calories, protein_g, carbs_g, fat_g, fiber_g, recipeId);
        } else {
          const r = insertRecipe.run(name, calories, protein_g, carbs_g, fat_g, fiber_g);
          recipeId = r.lastInsertRowid;
        }
        const ins = insertLog.run(
          recipeId,
          date,
          t,
          servingsRaw,
          notes || null,
          name,
          '1 serving',
          calories,
          protein_g,
          carbs_g,
          fat_g,
          fiber_g,
          1
        );
        return ins.lastInsertRowid;
      });
      entryId = run();
    } catch (e) {
      return res.status(500).json({ error: 'Failed to log custom meal' });
    }

    // Optional micronutrient estimate (e.g. from the AI Macro Logger).
    const microsJson = normalizeMicrosPayload(req.body);
    if (microsJson) {
      db.prepare('UPDATE log_entries SET micros_json = ? WHERE id = ?').run(microsJson, entryId);
    }

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(entryId));
  });

  router.get('/days', (req, res) => {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limit = limitRaw == null ? 60 : Number(limitRaw);
    const offset = offsetRaw == null ? 0 : Number(offsetRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 3650) {
      return res.status(400).json({ error: 'limit must be integer 1–3650' });
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
      return res.status(400).json({ error: 'offset must be integer 0–1,000,000' });
    }

    const rows = db
      .prepare(
        `
        SELECT le.date AS date,
               SUM(le.servings * COALESCE(le.recipe_calories, r.calories, 0)) AS calories,
               SUM(le.servings * COALESCE(le.recipe_protein_g, r.protein_g, 0)) AS protein_g,
               SUM(le.servings * COALESCE(le.recipe_carbs_g, r.carbs_g, 0)) AS carbs_g,
               SUM(le.servings * COALESCE(le.recipe_fat_g, r.fat_g, 0)) AS fat_g,
               COUNT(*) AS entries_count
          FROM log_entries le
          LEFT JOIN recipes r ON r.id = le.recipe_id
         GROUP BY le.date
         ORDER BY le.date DESC
         LIMIT ? OFFSET ?
        `
      )
      .all(limit, offset)
      .map(r => ({
        ...r,
        calories: r.calories != null ? Number(r.calories) : 0,
        protein_g: r.protein_g != null ? Number(r.protein_g) : 0,
        carbs_g: r.carbs_g != null ? Number(r.carbs_g) : 0,
        fat_g: r.fat_g != null ? Number(r.fat_g) : 0,
        entries_count: r.entries_count != null ? Number(r.entries_count) : 0,
      }));

    res.json(rows);
  });

  router.get('/', (req, res) => {
    const { date, start, end } = req.query;
    if (date) {
      return res.json(db.prepare(`${ENTRY_JOIN} WHERE le.date = ? ORDER BY le.id`).all(date));
    }
    if (start && end) {
      return res.json(
        db
          .prepare(`${ENTRY_JOIN} WHERE le.date >= ? AND le.date <= ? ORDER BY le.date, le.id`)
          .all(start, end)
      );
    }
    res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?start=YYYY-MM-DD&end=YYYY-MM-DD' });
  });

  router.post('/', (req, res) => {
    const { recipe_id, date, time_min, servings, notes, slot_selections, log_slot_customizations } = req.body;
    if (!recipe_id || !date || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, date, servings' });
    }
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
                is_quick_food, recipe_kind, remaining_uses, is_archived, meal_builder_meta
         FROM recipes WHERE id = ?`
      )
      .get(recipe_id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    if (recipe.is_archived) {
      return res.status(400).json({ error: 'This meal template is archived (no uses left). Reactivate it from Recipes or use another recipe.' });
    }

    const slots = listVariableSlotsFromRecipeRow(recipe);
    let perServing;
    let slotJson = null;
    if (slots.length > 0) {
      try {
        const resolved = resolveSlotsForLog(db, recipe, slot_selections, log_slot_customizations, null, true);
        perServing = adjustPerServingMacrosForResolvedSlots(db, recipe, resolved);
        slotJson = JSON.stringify(resolved);
      } catch (e) {
        return res.status(400).json({ error: mapSlotAdjustError(e) });
      }
    } else {
      perServing = {
        calories: recipe.calories,
        protein_g: recipe.protein_g,
        carbs_g: recipe.carbs_g,
        fat_g: recipe.fat_g,
        fiber_g: recipe.fiber_g,
      };
    }

    const t = normalizeTimeMin(time_min);

    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const decLimited = db.prepare(
      `UPDATE recipes
       SET remaining_uses = remaining_uses - 1,
           is_archived = CASE WHEN remaining_uses - 1 <= 0 THEN 1 ELSE is_archived END
       WHERE id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL AND remaining_uses > 0`
    );

    const run = db.transaction(() => {
      const result = insertLog.run(
        recipe_id,
        date,
        t,
        Number(servings),
        notes ?? null,
        recipe.name,
        recipe.serving_size,
        perServing.calories,
        perServing.protein_g,
        perServing.carbs_g,
        perServing.fat_g,
        perServing.fiber_g,
        recipe.is_quick_food ? 1 : 0,
        slotJson
      );
      if (recipe.recipe_kind === 'limited' && recipe.remaining_uses != null) {
        const u = decLimited.run(recipe_id);
        if (u.changes === 0) {
          throw new Error('LIMIT_USES');
        }
      }
      return result.lastInsertRowid;
    });

    let entryId;
    try {
      entryId = run();
    } catch (e) {
      if (e.message === 'LIMIT_USES') {
        return res.status(409).json({ error: 'No remaining uses for this meal template.' });
      }
      throw e;
    }

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(entryId));
  });

  /**
   * Update an existing entry (used for editing past days).
   * Date is intentionally not editable here to avoid accidental day moves.
   */
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = db.prepare('SELECT * FROM log_entries WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    const recipe_id = Object.prototype.hasOwnProperty.call(req.body, 'recipe_id')
      ? req.body.recipe_id
      : existing.recipe_id;
    const time_min = Object.prototype.hasOwnProperty.call(req.body, 'time_min')
      ? req.body.time_min
      : existing.time_min;
    const servings = Object.prototype.hasOwnProperty.call(req.body, 'servings')
      ? req.body.servings
      : existing.servings;
    const notes = Object.prototype.hasOwnProperty.call(req.body, 'notes') ? req.body.notes : existing.notes;
    const { slot_selections, log_slot_customizations } = req.body;

    if (!recipe_id || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, servings' });
    }
    const fullRecipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipe_id);
    if (!fullRecipe) return res.status(404).json({ error: 'Recipe not found' });

    const t = normalizeTimeMin(time_min);

    const recipeChanged = String(recipe_id) !== String(existing.recipe_id);
    const slots = listVariableSlotsFromRecipeRow(fullRecipe);
    const selectionUpdate =
      recipeChanged ||
      (slots.length > 0 &&
        (Object.prototype.hasOwnProperty.call(req.body, 'slot_selections') ||
          Object.prototype.hasOwnProperty.call(req.body, 'log_slot_customizations')));

    if (selectionUpdate) {
      let perServing;
      let slotJson = null;
      if (slots.length > 0) {
        try {
          const resolved = resolveSlotsForLog(
            db,
            fullRecipe,
            slot_selections,
            log_slot_customizations,
            existing.slot_selections_json,
            recipeChanged
          );
          perServing = adjustPerServingMacrosForResolvedSlots(db, fullRecipe, resolved);
          slotJson = JSON.stringify(resolved);
        } catch (e) {
          return res.status(400).json({ error: mapSlotAdjustError(e) });
        }
      } else {
        perServing = {
          calories: fullRecipe.calories,
          protein_g: fullRecipe.protein_g,
          carbs_g: fullRecipe.carbs_g,
          fat_g: fullRecipe.fat_g,
          fiber_g: fullRecipe.fiber_g,
        };
      }
      db.prepare(
        `UPDATE log_entries
         SET recipe_id = ?, time_min = ?, servings = ?, notes = ?,
             recipe_name = ?, serving_size = ?, recipe_calories = ?, recipe_protein_g = ?, recipe_carbs_g = ?, recipe_fat_g = ?, recipe_fiber_g = ?, recipe_is_quick_food = ?,
             slot_selections_json = ?
         WHERE id = ?`
      ).run(
        recipe_id,
        t,
        Number(servings),
        notes ?? null,
        fullRecipe.name,
        fullRecipe.serving_size,
        perServing.calories,
        perServing.protein_g,
        perServing.carbs_g,
        perServing.fat_g,
        perServing.fiber_g,
        fullRecipe.is_quick_food ? 1 : 0,
        slotJson,
        id
      );
    } else {
      db.prepare('UPDATE log_entries SET recipe_id = ?, time_min = ?, servings = ?, notes = ? WHERE id = ?').run(
        recipe_id,
        t,
        Number(servings),
        notes ?? null,
        id
      );
    }

    res.json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(id));
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
