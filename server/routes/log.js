const express = require('express');
const { uid } = require('../userId');
const {
  adjustPerServingMacrosForResolvedSlots,
  resolvedIngredientRows,
  resolveSlotsForLog,
  listVariableSlotsFromRecipeRow,
  listRecipeIngredientLines,
  resolveReceiptForLog,
} = require('../recipeIngredients');
const { buildMicrosBlob } = require('../microNutrients');
const {
  microsJsonFromIngredients,
  microsJsonPreferringLabels,
  normalizedIngredientsFromRecipe,
} = require('../mealMicros');
const { applyUsageMap, usageFromIngredientsJson, extractPreppedUsageFromRows } = require('../preppedBatchLib');

/** Client-sent micros object (back-compat) -> micros_json string, or null. */
function microsJsonFromClientMicros(body) {
  const blob = buildMicrosBlob(body?.micros, { confidence: body?.micros_confidence, notes: body?.micros_notes });
  return blob ? JSON.stringify(blob) : null;
}

/**
 * Normalize client-provided per-ingredient rows (AI Logger / Meal Builder) into
 * the stored breakdown shape. Keeps macro fields when present; drops unusable
 * rows. Returns a JSON string or null (so old/empty logs stay null).
 */
function ingredientsJsonFromClientRows(rows) {
  if (!Array.isArray(rows)) return null;
  const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const amount = r.amount != null && r.amount !== '' && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null;
    const row = {
      name,
      amount,
      unit: typeof r.unit === 'string' ? r.unit : '',
      calories: num(r.calories),
      protein_g: num(r.protein_g),
      carbs_g: num(r.carbs_g),
      fat_g: num(r.fat_g),
      source: ['provided', 'library', 'ai', 'recipe', 'common', 'manual'].includes(r.source) ? r.source : 'estimated',
    };
    if (r.fiber_g != null) row.fiber_g = num(r.fiber_g);
    if (Number.isInteger(Number(r.label_ingredient_id)) && Number(r.label_ingredient_id) > 0) {
      row.label_ingredient_id = Number(r.label_ingredient_id);
    }
    if (Number.isInteger(Number(r.prepped_batch_id)) && Number(r.prepped_batch_id) > 0) {
      row.prepped_batch_id = Number(r.prepped_batch_id);
    }
    out.push(row);
    if (out.length >= 60) break;
  }
  return out.length ? JSON.stringify(out) : null;
}

/** Resolved per-ingredient rows for a recipe log (array). Never throws. */
function safeRecipeIngredientRows(db, recipe, resolvedSlots, userId) {
  try {
    return resolvedIngredientRows(db, recipe, resolvedSlots || {}, userId);
  } catch {
    return [];
  }
}

/** Resolved per-ingredient rows -> JSON string, or null. */
function ingredientsJsonFromRows(rows) {
  return Array.isArray(rows) && rows.length ? JSON.stringify(rows) : null;
}

/**
 * Resolve micros_json for a log entry (best-effort, synchronous-with-timeout).
 * Precedence — always the actual logged ingredients, never recipe defaults
 * once a resolved list exists:
 *   1. request ingredients (AI Logger / Meal Builder reviewed rows)
 *   2. resolvedRows (recipe log AFTER substitutions / edited amounts / removals)
 *   3. recipe default ingredients (fallback only when no resolved rows exist,
 *      e.g. a manual name-only recipe)
 *   4. client-sent micros object
 */
async function resolveMicrosJson(db, body, recipe, resolvedRows = null, userId) {
  if (Array.isArray(body?.ingredients) && body.ingredients.length) {
    return microsJsonPreferringLabels(db, body.ingredients, userId);
  }
  if (Array.isArray(resolvedRows) && resolvedRows.length) {
    return microsJsonPreferringLabels(db, resolvedRows, userId);
  }
  if (recipe && !recipe.is_quick_food) {
    const ings = normalizedIngredientsFromRecipe(db, recipe);
    if (ings.length) return microsJsonFromIngredients(ings);
  }
  return microsJsonFromClientMicros(body);
}

const ENTRY_JOIN = `
  SELECT le.id, le.recipe_id, le.date, le.time_min, le.servings, le.notes,
         le.slot_selections_json, le.micros_json, le.ingredients_json,
         COALESCE(le.source, 'app') AS source,
         le.weight_basis, le.nutrition_source,
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

const LOG_ALIVE = `COALESCE(le.is_deleted, 0) = 0`;

function hasSlotPayload(body) {
  return !!(
    (body?.slot_selections && typeof body.slot_selections === 'object' && !Array.isArray(body.slot_selections)) ||
    (body?.log_slot_customizations && typeof body.log_slot_customizations === 'object' && !Array.isArray(body.log_slot_customizations))
  );
}

/** Default log receipt from the recipe's library lines (no client ingredients). */
function receiptFromRecipeTemplate(db, recipe, userId) {
  const lines = listRecipeIngredientLines(recipe);
  if (!lines.length) return null;
  return resolveReceiptForLog(
    db,
    lines.map(l => ({
      name: l.name,
      amount: Number(l.amount),
      unit: l.unit,
      label_ingredient_id: l.label_ingredient_id,
    })),
    userId
  );
}

function mapSlotAdjustError(e) {
  if (!e || !e.code) return 'Could not calculate meal macros.';
  if (e.code === 'EMPTY_RECEIPT') return 'Add at least one ingredient with a valid amount.';
  if (e.code === 'INVALID_SLOT_SELECTION') return 'Invalid ingredient choice for a variable slot.';
  if (e.code === 'INVALID_LOG_SLOT_CUSTOMIZATION') return 'Invalid log-time ingredient customization.';
  if (e.code === 'INVALID_SLOT_AMOUNT') return 'Invalid amount on a recipe variable slot.';
  if (e.code === 'LABEL_INGREDIENT_NOT_FOUND') return 'A selected ingredient was not found in your library.';
  if (e.code === 'LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING') {
    return 'An ingredient needs grams per serving to calculate macros. Edit it in Ingredient Library.';
  }
  if (e.code === 'LABEL_INGREDIENT_UNIT_NOT_CONVERTIBLE') {
    const name = e.ingredientName ? `“${e.ingredientName}”` : 'An ingredient';
    const unit = e.unit ? ` in ${e.unit}` : '';
    return `${name} can’t be measured${unit}. Add its gram equivalent in Ingredient Library, or log it in its own unit.`;
  }
  if (e.code === 'PREPPED_BATCH_NOT_FOUND') return 'A prepped batch was not found or is depleted.';
  if (e.code === 'PREPPED_BATCH_EXHAUSTED') {
    const name = e.batchName ? `“${e.batchName}”` : 'That prepped batch';
    return `${name} does not have enough left.`;
  }
  if (e.code === 'PREPPED_BATCH_GRAMS_ONLY') return 'Prepped batches must be logged in grams.';
  return e.message || 'Could not calculate meal macros.';
}

function usageFromResolvedRows(rows, servings = 1) {
  const mult = Math.max(1, Number(servings) || 1);
  if (!Array.isArray(rows)) return new Map();
  const scaled = rows
    .filter(r => r && r.prepped_batch_id)
    .map(r => ({ ...r, amount: Number(r.amount) * mult }));
  return extractPreppedUsageFromRows(scaled);
}

function usageFromEntry(entry) {
  const base = usageFromIngredientsJson(entry?.ingredients_json);
  const mult = Math.max(1, Number(entry?.servings) || 1);
  if (mult === 1) return base;
  const scaled = new Map();
  for (const [id, g] of base.entries()) scaled.set(id, g * mult);
  return scaled;
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
    const userId = uid(req);
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
       WHERE user_id = ? AND COALESCE(is_quick_food, 0) = 1 AND lower(name) = lower(?) AND serving_size = '100 g'
       ORDER BY id ASC LIMIT 1`
    );
    const updateExisting = db.prepare(
      `UPDATE recipes
       SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = NULL, ingredients = '[]', recipe_kind = 'permanent', is_archived = 0, meal_builder_meta = NULL, is_quick_food = 1
       WHERE id = ? AND user_id = ?`
    );
    const insertRecipe = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food)
       VALUES (?, ?, '100 g', ?, ?, ?, ?, NULL, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    );
    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );

    let entryId;
    try {
      const run = db.transaction(() => {
        const existing = findExisting.get(userId, name);
        let recipeId;
        if (existing?.id) {
          recipeId = existing.id;
          updateExisting.run(calories_100g, protein_g_100g, carbs_g_100g, fat_g_100g, recipeId, userId);
        } else {
          const r = insertRecipe.run(userId, name, calories_100g, protein_g_100g, carbs_g_100g, fat_g_100g);
          recipeId = r.lastInsertRowid;
        }
        const ins = insertLog.run(
          userId,
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

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ? AND le.user_id = ?`).get(entryId, userId));
  });

  /**
   * Log a one-off meal from absolute (per-serving) macros — e.g. macros worked
   * out elsewhere and pasted in. Like quick-food, this writes to a hidden
   * (is_quick_food=1) backing recipe so it appears in the daily log/history but
   * NEVER in the Recipe Library. Deduped by name so repeats don't pile up.
   */
  router.post('/custom', async (req, res) => {
    const userId = uid(req);
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
    const ingredientsJson = ingredientsJsonFromClientRows(req.body?.ingredients);
    const batchUsage = usageFromIngredientsJson(ingredientsJson);

    const findExisting = db.prepare(
      `SELECT id FROM recipes
       WHERE user_id = ? AND COALESCE(is_quick_food, 0) = 1 AND lower(name) = lower(?) AND serving_size = '1 serving'
       ORDER BY id ASC LIMIT 1`
    );
    const updateExisting = db.prepare(
      `UPDATE recipes
       SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, ingredients = '[]', recipe_kind = 'permanent', is_archived = 0, meal_builder_meta = NULL, is_quick_food = 1
       WHERE id = ? AND user_id = ?`
    );
    const insertRecipe = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food)
       VALUES (?, ?, '1 serving', ?, ?, ?, ?, ?, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    );
    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );

    let entryId;
    try {
      const run = db.transaction(() => {
        const existing = findExisting.get(userId, name);
        let recipeId;
        if (existing?.id) {
          recipeId = existing.id;
          updateExisting.run(calories, protein_g, carbs_g, fat_g, fiber_g, recipeId, userId);
        } else {
          const r = insertRecipe.run(userId, name, calories, protein_g, carbs_g, fat_g, fiber_g);
          recipeId = r.lastInsertRowid;
        }
        const ins = insertLog.run(
          userId,
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
        const newId = ins.lastInsertRowid;
        if (ingredientsJson) {
          db.prepare('UPDATE log_entries SET ingredients_json = ? WHERE id = ? AND user_id = ?').run(
            ingredientsJson,
            newId,
            userId
          );
        }
        if (batchUsage.size) applyUsageMap(db, userId, batchUsage, 1);
        return newId;
      });
      entryId = run();
    } catch (e) {
      if (e.code === 'PREPPED_BATCH_EXHAUSTED' || e.code === 'PREPPED_BATCH_NOT_FOUND') {
        return res.status(409).json({ error: mapSlotAdjustError(e) });
      }
      return res.status(500).json({ error: 'Failed to log custom meal' });
    }

    // Optional micronutrient estimate — ingredients (AI Logger / Meal Builder)
    // or a client-sent micros object. Best-effort; never blocks the log.
    const microsJson = await resolveMicrosJson(db, req.body, null, null, userId);
    if (microsJson) {
      db.prepare('UPDATE log_entries SET micros_json = ? WHERE id = ? AND user_id = ?').run(microsJson, entryId, userId);
    }

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ? AND le.user_id = ?`).get(entryId, userId));
  });

  router.get('/days', (req, res) => {
    const userId = uid(req);
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
         WHERE le.user_id = ? AND COALESCE(le.is_deleted, 0) = 0
         GROUP BY le.date
         ORDER BY le.date DESC
         LIMIT ? OFFSET ?
        `
      )
      .all(userId, limit, offset)
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
    const userId = uid(req);
    const { date, start, end } = req.query;
    if (date) {
      return res.json(
        db.prepare(`${ENTRY_JOIN} WHERE le.user_id = ? AND le.date = ? AND ${LOG_ALIVE} ORDER BY le.id`).all(userId, date)
      );
    }
    if (start && end) {
      return res.json(
        db
          .prepare(
            `${ENTRY_JOIN} WHERE le.user_id = ? AND le.date >= ? AND le.date <= ? AND ${LOG_ALIVE} ORDER BY le.date, le.id`
          )
          .all(userId, start, end)
      );
    }
    res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?start=YYYY-MM-DD&end=YYYY-MM-DD' });
  });

  router.post('/', async (req, res) => {
    const userId = uid(req);
    const { recipe_id, date, time_min, servings, notes, slot_selections, log_slot_customizations, ingredients } = req.body;
    if (!recipe_id || !date || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, date, servings' });
    }
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
                is_quick_food, recipe_kind, remaining_uses, is_archived, meal_builder_meta
         FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(recipe_id, userId);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    if (recipe.is_archived) {
      return res.status(400).json({ error: 'This meal template is archived (no uses left). Reactivate it from Recipes or use another recipe.' });
    }

    const hasReceipt = Array.isArray(ingredients) && ingredients.length > 0;
    let perServing;
    let slotJson = null;
    let resolvedSlots = null;
    let recipeRows = [];
    let ingredientsJson = null;

    if (hasReceipt) {
      try {
        const resolved = resolveReceiptForLog(db, ingredients, userId);
        perServing = resolved.perServing;
        recipeRows = resolved.rows;
        ingredientsJson = ingredientsJsonFromRows(recipeRows);
      } catch (e) {
        return res.status(400).json({ error: mapSlotAdjustError(e) });
      }
    } else if (hasSlotPayload(req.body)) {
      // Dual-read for old clients that still post slot customizations.
      const slots = listVariableSlotsFromRecipeRow(recipe);
      if (slots.length > 0) {
        try {
          resolvedSlots = resolveSlotsForLog(db, recipe, slot_selections, log_slot_customizations, null, true, userId);
          perServing = adjustPerServingMacrosForResolvedSlots(db, recipe, resolvedSlots, userId);
          slotJson = JSON.stringify(resolvedSlots);
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
      recipeRows = safeRecipeIngredientRows(db, recipe, resolvedSlots, userId);
      ingredientsJson = ingredientsJsonFromRows(recipeRows);
    } else {
      try {
        const fromTemplate = receiptFromRecipeTemplate(db, recipe, userId);
        if (fromTemplate) {
          perServing = fromTemplate.perServing;
          recipeRows = fromTemplate.rows;
          ingredientsJson = ingredientsJsonFromRows(recipeRows);
        } else {
          perServing = {
            calories: recipe.calories,
            protein_g: recipe.protein_g,
            carbs_g: recipe.carbs_g,
            fat_g: recipe.fat_g,
            fiber_g: recipe.fiber_g,
          };
          recipeRows = safeRecipeIngredientRows(db, recipe, null, userId);
          ingredientsJson = ingredientsJsonFromRows(recipeRows);
        }
      } catch (e) {
        return res.status(400).json({ error: mapSlotAdjustError(e) });
      }
    }

    const t = normalizeTimeMin(time_min);

    const insertLog = db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food,
         slot_selections_json, ingredients_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const decLimited = db.prepare(
      `UPDATE recipes
       SET remaining_uses = remaining_uses - ?,
           is_archived = CASE WHEN remaining_uses - ? <= 0 THEN 1 ELSE is_archived END
       WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL AND remaining_uses >= ?`
    );

    const run = db.transaction(() => {
      const result = insertLog.run(
        userId,
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
        slotJson,
        ingredientsJson
      );
      if (recipe.recipe_kind === 'limited' && recipe.remaining_uses != null) {
        const uses = Math.max(1, Math.ceil(Number(servings) || 1));
        const u = decLimited.run(uses, uses, recipe_id, userId, uses);
        if (u.changes === 0) {
          throw new Error('LIMIT_USES');
        }
      }
      const batchUsage = usageFromResolvedRows(
        ingredientsJson ? JSON.parse(ingredientsJson) : [],
        servings
      );
      if (batchUsage.size) applyUsageMap(db, userId, batchUsage, 1);
      return result.lastInsertRowid;
    });

    let entryId;
    try {
      entryId = run();
    } catch (e) {
      if (e.message === 'LIMIT_USES') {
        return res.status(409).json({ error: 'No remaining uses for this meal template.' });
      }
      if (e.code === 'PREPPED_BATCH_EXHAUSTED' || e.code === 'PREPPED_BATCH_NOT_FOUND') {
        return res.status(409).json({ error: mapSlotAdjustError(e) });
      }
      throw e;
    }

    const microsJson = await resolveMicrosJson(db, req.body, recipe, recipeRows, userId);
    if (microsJson) {
      db.prepare('UPDATE log_entries SET micros_json = ? WHERE id = ? AND user_id = ?').run(microsJson, entryId, userId);
    }

    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ? AND le.user_id = ?`).get(entryId, userId));
  });

  /**
   * Update an existing entry (used for editing past days).
   * Date is intentionally not editable here to avoid accidental day moves.
   */
  router.put('/:id', async (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = db
      .prepare('SELECT * FROM log_entries WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, 0) = 0')
      .get(id, userId);
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
    const { slot_selections, log_slot_customizations, ingredients } = req.body;

    if (!recipe_id || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, servings' });
    }
    const fullRecipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(recipe_id, userId);
    if (!fullRecipe) return res.status(404).json({ error: 'Recipe not found' });

    const t = normalizeTimeMin(time_min);

    const recipeChanged = String(recipe_id) !== String(existing.recipe_id);
    const hasReceipt = Array.isArray(ingredients) && ingredients.length > 0;
    const slots = listVariableSlotsFromRecipeRow(fullRecipe);
    const selectionUpdate = recipeChanged || hasReceipt || hasSlotPayload(req.body);

    // Limited-use accounting for edits — mirrors the POST decrement and the
    // DELETE restore so remaining_uses stays honest however an entry changes:
    // servings up consumes the delta (409 when not enough remain), servings
    // down hands the difference back, and a recipe swap restores the old
    // template before charging the new one. Runs inside the same transaction
    // as the entry UPDATE. Throws 'LIMIT_USES' when uses run out.
    const usesOf = s => Math.max(1, Math.ceil(Number(s) || 1));
    const consumeLimited = db.prepare(
      `UPDATE recipes
       SET remaining_uses = remaining_uses - ?,
           is_archived = CASE WHEN remaining_uses - ? <= 0 THEN 1 ELSE is_archived END
       WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL AND remaining_uses >= ?`
    );
    const restoreLimited = db.prepare(
      `UPDATE recipes
       SET remaining_uses = CASE
             WHEN max_uses IS NOT NULL THEN MIN(max_uses, remaining_uses + ?)
             ELSE remaining_uses + ?
           END,
           is_archived = CASE WHEN remaining_uses <= 0 THEN 0 ELSE is_archived END
       WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL`
    );
    const isLimited = r => r && r.recipe_kind === 'limited' && r.remaining_uses != null;
    function adjustLimitedUses() {
      if (recipeChanged) {
        const oldRecipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(existing.recipe_id, userId);
        if (isLimited(oldRecipe)) {
          const back = usesOf(existing.servings);
          restoreLimited.run(back, back, oldRecipe.id, userId);
        }
        if (isLimited(fullRecipe)) {
          const need = usesOf(servings);
          if (consumeLimited.run(need, need, fullRecipe.id, userId, need).changes === 0) {
            throw new Error('LIMIT_USES');
          }
        }
        return;
      }
      if (!isLimited(fullRecipe)) return;
      const delta = usesOf(servings) - usesOf(existing.servings);
      if (delta > 0) {
        if (consumeLimited.run(delta, delta, fullRecipe.id, userId, delta).changes === 0) {
          throw new Error('LIMIT_USES');
        }
      } else if (delta < 0) {
        restoreLimited.run(-delta, -delta, fullRecipe.id, userId);
      }
    }

    if (selectionUpdate) {
      let perServing;
      let slotJson = null;
      let resolvedSlots = null;
      let recipeRows = [];
      let ingredientsJson = null;

      if (hasReceipt) {
        try {
          const resolved = resolveReceiptForLog(db, ingredients, userId);
          perServing = resolved.perServing;
          recipeRows = resolved.rows;
          ingredientsJson = ingredientsJsonFromRows(recipeRows);
          slotJson = null;
        } catch (e) {
          return res.status(400).json({ error: mapSlotAdjustError(e) });
        }
      } else if (hasSlotPayload(req.body) && slots.length > 0) {
        try {
          resolvedSlots = resolveSlotsForLog(
            db,
            fullRecipe,
            slot_selections,
            log_slot_customizations,
            existing.slot_selections_json,
            recipeChanged,
            userId
          );
          perServing = adjustPerServingMacrosForResolvedSlots(db, fullRecipe, resolvedSlots, userId);
          slotJson = JSON.stringify(resolvedSlots);
        } catch (e) {
          return res.status(400).json({ error: mapSlotAdjustError(e) });
        }
        recipeRows = safeRecipeIngredientRows(db, fullRecipe, resolvedSlots, userId);
        ingredientsJson = ingredientsJsonFromRows(recipeRows);
      } else {
        try {
          const fromTemplate = receiptFromRecipeTemplate(db, fullRecipe, userId);
          if (fromTemplate) {
            perServing = fromTemplate.perServing;
            recipeRows = fromTemplate.rows;
            ingredientsJson = ingredientsJsonFromRows(recipeRows);
            slotJson = null;
          } else {
            perServing = {
              calories: fullRecipe.calories,
              protein_g: fullRecipe.protein_g,
              carbs_g: fullRecipe.carbs_g,
              fat_g: fullRecipe.fat_g,
              fiber_g: fullRecipe.fiber_g,
            };
            recipeRows = safeRecipeIngredientRows(db, fullRecipe, null, userId);
            ingredientsJson = ingredientsJsonFromRows(recipeRows);
          }
        } catch (e) {
          return res.status(400).json({ error: mapSlotAdjustError(e) });
        }
      }
      try {
        db.transaction(() => {
          adjustLimitedUses();
          applyUsageMap(db, userId, usageFromEntry(existing), -1);
          db.prepare(
            `UPDATE log_entries
             SET recipe_id = ?, time_min = ?, servings = ?, notes = ?,
                 recipe_name = ?, serving_size = ?, recipe_calories = ?, recipe_protein_g = ?, recipe_carbs_g = ?, recipe_fat_g = ?, recipe_fiber_g = ?, recipe_is_quick_food = ?,
                 slot_selections_json = ?, ingredients_json = ?
             WHERE id = ? AND user_id = ?`
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
            ingredientsJson,
            id,
            userId
          );
          applyUsageMap(
            db,
            userId,
            usageFromResolvedRows(recipeRows, servings),
            1
          );
        })();
      } catch (e) {
        if (e.message === 'LIMIT_USES') {
          return res.status(409).json({ error: 'No remaining uses for this meal template.' });
        }
        if (e.code === 'PREPPED_BATCH_EXHAUSTED' || e.code === 'PREPPED_BATCH_NOT_FOUND') {
          return res.status(409).json({ error: mapSlotAdjustError(e) });
        }
        throw e;
      }

      const microsJson = await resolveMicrosJson(db, req.body, fullRecipe, recipeRows, userId);
      if (microsJson) {
        db.prepare('UPDATE log_entries SET micros_json = ? WHERE id = ? AND user_id = ?').run(microsJson, id, userId);
      } else if (!recipeRows.length && !(Array.isArray(req.body?.ingredients) && req.body.ingredients.length)) {
        db.prepare('UPDATE log_entries SET micros_json = NULL WHERE id = ? AND user_id = ?').run(id, userId);
      }
    } else {
      try {
        db.transaction(() => {
          adjustLimitedUses();
          const servingsChanged = Number(servings) !== Number(existing.servings);
          if (servingsChanged && existing.ingredients_json) {
            let rows;
            try { rows = JSON.parse(existing.ingredients_json); } catch { rows = []; }
            applyUsageMap(db, userId, usageFromResolvedRows(rows, existing.servings), -1);
            applyUsageMap(db, userId, usageFromResolvedRows(rows, servings), 1);
          }
          db.prepare('UPDATE log_entries SET recipe_id = ?, time_min = ?, servings = ?, notes = ? WHERE id = ? AND user_id = ?').run(
            recipe_id,
            t,
            Number(servings),
            notes ?? null,
            id,
            userId
          );
        })();
      } catch (e) {
        if (e.message === 'LIMIT_USES') {
          return res.status(409).json({ error: 'No remaining uses for this meal template.' });
        }
        if (e.code === 'PREPPED_BATCH_EXHAUSTED' || e.code === 'PREPPED_BATCH_NOT_FOUND') {
          return res.status(409).json({ error: mapSlotAdjustError(e) });
        }
        throw e;
      }
    }

    res.json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ? AND le.user_id = ?`).get(id, userId));
  });

  router.delete('/:id', (req, res) => {
    const userId = uid(req);
    const entry = db
      .prepare('SELECT * FROM log_entries WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, 0) = 0')
      .get(req.params.id, userId);
    if (!entry) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    // Deleting a log means "I didn't eat it" — hand the consumed servings back
    // to a limited template (mirror of the decrement on POST), capped at
    // max_uses. Un-archive only when the template was exhausted (remaining 0),
    // so a manually archived template stays archived. Note: column references
    // in SET expressions read the pre-update values.
    const restoreLimited = db.prepare(
      `UPDATE recipes
       SET remaining_uses = CASE
             WHEN max_uses IS NOT NULL THEN MIN(max_uses, remaining_uses + ?)
             ELSE remaining_uses + ?
           END,
           is_archived = CASE WHEN remaining_uses <= 0 THEN 0 ELSE is_archived END
       WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL`
    );

    db.transaction(() => {
      applyUsageMap(db, userId, usageFromEntry(entry), -1);
      db.prepare(
        `UPDATE log_entries SET is_deleted = 1 WHERE id = ? AND user_id = ?`
      ).run(entry.id, userId);
      if (entry.recipe_id != null) {
        const uses = Math.max(1, Math.ceil(Number(entry.servings) || 1));
        restoreLimited.run(uses, uses, entry.recipe_id, userId);
      }
    })();

    res.status(204).send();
  });

  return router;
}

module.exports = { createLogRouter };
