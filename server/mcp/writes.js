/**
 * MCP direct writes (Phase 3 Part A).
 * Writes commit immediately. Propose/commit handshake removed.
 */
const { isoDateOrNull, getLocalDateISO } = require('./dates');
const { doseMultiplier } = require('../supplementDose');
const reads = require('./reads');

const NUTRITION_SOURCES = new Set(['label', 'database', 'estimate']);
const WEIGHT_BASES = new Set(['raw', 'cooked']);

const OPS = {
  log_meal: 'log_meal',
  add_food_item: 'add_food_item',
  update_food_item: 'update_food_item',
  update_meal_entry: 'update_meal_entry',
  delete_meal_entry: 'delete_meal_entry',
  update_supplement: 'update_supplement',
  write_batch: 'write_batch',
};

function nowIso() {
  return new Date().toISOString();
}

function round(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

function normalizeNutritionSource(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return NUTRITION_SOURCES.has(s) ? s : null;
}

function normalizeWeightBasis(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return WEIGHT_BASES.has(s) ? s : null;
}

function parseJson(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function searchSimilarIngredients(db, userId, name, { limit = 8 } = {}) {
  const q = String(name || '').trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, created_via, nutrition_source
         FROM label_ingredients
        WHERE user_id = ? AND lower(name) LIKE lower(?)
        ORDER BY use_count DESC, id DESC
        LIMIT ?`
    )
    .all(userId, like, limit);
}

function scalePer100g(macros, quantityG) {
  const f = Number(quantityG) / 100;
  return {
    calories: round((Number(macros.calories) || 0) * f, 1),
    protein_g: round((Number(macros.protein_g) || 0) * f, 2),
    carbs_g: round((Number(macros.carbs_g) || 0) * f, 2),
    fat_g: round((Number(macros.fat_g) || 0) * f, 2),
    fiber_g:
      macros.fiber_g == null || macros.fiber_g === ''
        ? null
        : round((Number(macros.fiber_g) || 0) * f, 2),
  };
}

function scaleFromServing(row, quantityG) {
  const gps = Number(row.grams_per_serving);
  if (!Number.isFinite(gps) || gps <= 0) return null;
  const f = Number(quantityG) / gps;
  return {
    calories: round((Number(row.calories) || 0) * f, 1),
    protein_g: round((Number(row.protein_g) || 0) * f, 2),
    carbs_g: round((Number(row.carbs_g) || 0) * f, 2),
    fat_g: round((Number(row.fat_g) || 0) * f, 2),
    fiber_g: row.fiber_g == null ? null : round((Number(row.fiber_g) || 0) * f, 2),
  };
}

function findIdempotent(db, userId, operationId) {
  if (!operationId) return null;
  const row = db
    .prepare(
      `SELECT * FROM mcp_write_audit
        WHERE user_id = ? AND operation_id = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(userId, String(operationId));
  if (!row) return null;
  const response = parseJson(row.response_json, null);
  if (response) return { ...response, idempotent: true, audit_id: row.id };
  return {
    idempotent: true,
    audit_id: row.id,
    op: row.op || row.kind,
    result_row_ids: parseJson(row.result_row_ids_json, {}),
    before: parseJson(row.before_json, null),
    after: parseJson(row.after_json, null),
  };
}

function recordAudit(db, userId, {
  op,
  operationId,
  before,
  after,
  result_row_ids,
  warnings = [],
  response,
}) {
  const info = db
    .prepare(
      `INSERT INTO mcp_write_audit (
         user_id, proposal_id, kind, confirmation_code, user_confirmation_text,
         preview_json, result_row_ids_json, operation_id, created_at,
         op, before_json, after_json, response_json, warnings_json
       ) VALUES (?, NULL, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      op,
      JSON.stringify(after ?? {}),
      JSON.stringify(result_row_ids ?? {}),
      operationId || null,
      nowIso(),
      op,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      JSON.stringify(response ?? {}),
      JSON.stringify(warnings || [])
    );
  return info.lastInsertRowid;
}

function withIdempotency(db, userId, operationId, runFn) {
  const existing = findIdempotent(db, userId, operationId);
  if (existing) return existing;
  return runFn();
}

function resolveMealItem(db, userId, item, mealWeightBasis, index, refMap) {
  const warnings = [];
  let working = item;
  if (working?.ref && refMap) {
    const resolvedId = refMap.get(String(working.ref));
    if (!resolvedId) return { error: `items[${index}]: unknown ref "${working.ref}"` };
    working = {
      ...working,
      label_ingredient_id: resolvedId,
      nutrition_source: working.nutrition_source || 'database',
    };
  }

  const nutrition_source = normalizeNutritionSource(working?.nutrition_source);
  if (!nutrition_source) {
    return { error: `items[${index}].nutrition_source must be label|database|estimate` };
  }
  const weight_basis = normalizeWeightBasis(working?.weight_basis) || mealWeightBasis;
  if (!weight_basis) {
    return { error: `items[${index}].weight_basis (or meal weight_basis) must be raw|cooked` };
  }

  const quantity_g = Number(working?.quantity_g);
  const servings = working?.servings != null ? Number(working.servings) : null;

  if (working?.label_ingredient_id != null) {
    const id = Number(working.label_ingredient_id);
    const row = db
      .prepare(
        `SELECT id, name, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g, micros_json
           FROM label_ingredients WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return { error: `items[${index}]: label_ingredient_id ${id} not found` };
    if (!Number.isFinite(quantity_g) || quantity_g <= 0) {
      return { error: `items[${index}].quantity_g must be a positive number` };
    }
    const macros = scaleFromServing(row, quantity_g);
    if (!macros) {
      return { error: `items[${index}]: ingredient "${row.name}" needs grams_per_serving` };
    }
    return {
      item: {
        kind: 'label_ingredient',
        label_ingredient_id: row.id,
        name: row.name,
        quantity_g,
        weight_basis,
        nutrition_source,
        macros,
        micros: parseJson(row.micros_json, null),
      },
      warnings,
    };
  }

  if (working?.recipe_id != null) {
    const id = Number(working.recipe_id);
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_deleted
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!recipe || recipe.is_deleted) {
      return { error: `items[${index}]: recipe_id ${id} not found` };
    }
    const s = Number.isFinite(servings) && servings > 0 ? servings : null;
    if (s == null) return { error: `items[${index}]: recipe items need servings` };
    return {
      item: {
        kind: 'recipe',
        recipe_id: recipe.id,
        name: recipe.name,
        servings: s,
        quantity_g: Number.isFinite(quantity_g) ? quantity_g : null,
        weight_basis,
        nutrition_source: 'database',
        macros: {
          calories: round((Number(recipe.calories) || 0) * s, 1),
          protein_g: round((Number(recipe.protein_g) || 0) * s, 2),
          carbs_g: round((Number(recipe.carbs_g) || 0) * s, 2),
          fat_g: round((Number(recipe.fat_g) || 0) * s, 2),
          fiber_g: recipe.fiber_g == null ? null : round((Number(recipe.fiber_g) || 0) * s, 2),
        },
        serving_size: recipe.serving_size,
      },
      warnings,
    };
  }

  const name = String(working?.name || '').trim();
  if (!name) {
    return { error: `items[${index}]: provide label_ingredient_id, recipe_id, ref, or new-food fields` };
  }
  if (!Number.isFinite(quantity_g) || quantity_g <= 0) {
    return { error: `items[${index}].quantity_g must be a positive number` };
  }
  const per100 = {
    calories: Number(working?.calories_per_100g),
    protein_g: Number(working?.protein_g_per_100g),
    carbs_g: Number(working?.carbs_g_per_100g),
    fat_g: Number(working?.fat_g_per_100g),
    fiber_g:
      working?.fiber_g_per_100g == null || working?.fiber_g_per_100g === ''
        ? null
        : Number(working.fiber_g_per_100g),
  };
  if (![per100.calories, per100.protein_g, per100.carbs_g, per100.fat_g].every(Number.isFinite)) {
    return { error: `items[${index}]: new items need per-100g macros` };
  }
  const similar = searchSimilarIngredients(db, userId, name);
  if (similar.length) {
    warnings.push(`Similar library items found for "${name}".`);
  }
  return {
    item: {
      kind: 'new_food',
      name,
      quantity_g,
      weight_basis,
      nutrition_source,
      per_100g: per100,
      macros: scalePer100g(per100, quantity_g),
      similar_library_items: similar,
      micros_per_100g: working?.micros_per_100g || null,
    },
    warnings,
  };
}

function sumItemMacros(resolved) {
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null };
  for (const it of resolved) {
    totals.calories += it.macros.calories || 0;
    totals.protein_g += it.macros.protein_g || 0;
    totals.carbs_g += it.macros.carbs_g || 0;
    totals.fat_g += it.macros.fat_g || 0;
    if (it.macros.fiber_g != null) totals.fiber_g = (totals.fiber_g || 0) + it.macros.fiber_g;
  }
  totals.calories = round(totals.calories, 1);
  totals.protein_g = round(totals.protein_g, 2);
  totals.carbs_g = round(totals.carbs_g, 2);
  totals.fat_g = round(totals.fat_g, 2);
  if (totals.fiber_g != null) totals.fiber_g = round(totals.fiber_g, 2);
  return totals;
}

function ensureQuickFoodRecipe(db, userId, name, macros) {
  const existing = db
    .prepare(
      `SELECT id FROM recipes
        WHERE user_id = ? AND COALESCE(is_quick_food, 0) = 1 AND lower(name) = lower(?) AND serving_size = '1 serving'
        ORDER BY id ASC LIMIT 1`
    )
    .get(userId, name);
  if (existing?.id) {
    db.prepare(
      `UPDATE recipes SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
              ingredients = '[]', recipe_kind = 'permanent', is_archived = 0, meal_builder_meta = NULL, is_quick_food = 1
        WHERE id = ? AND user_id = ?`
    ).run(macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g, macros.fiber_g, existing.id, userId);
    return existing.id;
  }
  const r = db
    .prepare(
      `INSERT INTO recipes (
         user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g,
         ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food
       ) VALUES (?, ?, '1 serving', ?, ?, ?, ?, ?, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    )
    .run(userId, name, macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g, macros.fiber_g);
  return r.lastInsertRowid;
}

function createLabelFromNewFood(db, userId, item) {
  const per100 = item.per_100g;
  const micros =
    item.micros_per_100g && typeof item.micros_per_100g === 'object'
      ? JSON.stringify({ micros: item.micros_per_100g, confidence: 'medium' })
      : null;
  const r = db
    .prepare(
      `INSERT INTO label_ingredients (
         user_id, name, base_label, brand_name, serving_size_text, grams_per_serving,
         calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri, source_type,
         use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit,
         barcode, micros_json, created_via, weight_basis, nutrition_source
       ) VALUES (?, ?, NULL, NULL, '100 g', 100, ?, ?, ?, ?, ?, NULL, 'manual',
                 0, NULL, 'weight', NULL, NULL, NULL, NULL, ?, 'mcp', ?, ?)`
    )
    .run(
      userId, item.name, per100.calories, per100.protein_g, per100.carbs_g, per100.fat_g,
      per100.fiber_g, micros, item.weight_basis, item.nutrition_source
    );
  return r.lastInsertRowid;
}

function fetchLogEntryById(db, userId, id) {
  const raw = db
    .prepare(
      `SELECT le.id, le.recipe_id, le.date, le.time_min, le.servings, le.notes,
              le.ingredients_json, COALESCE(le.source, 'app') AS source,
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
        WHERE le.id = ? AND le.user_id = ?`
    )
    .get(id, userId);
  if (!raw) return null;
  const day = reads.getDay(db, userId, raw.date);
  const shaped = (day.meals || []).find(m => Number(m.id) === Number(id));
  if (shaped) return shaped;
  return {
    id: raw.id,
    date: raw.date,
    time_min: raw.time_min,
    servings: raw.servings,
    notes: raw.notes,
    recipe_name: raw.recipe_name,
    serving_size: raw.serving_size,
    source: raw.source,
    weight_basis: raw.weight_basis,
    nutrition_source: raw.nutrition_source,
    per_serving: {
      calories: raw.recipe_calories,
      protein_g: raw.recipe_protein_g,
      carbs_g: raw.recipe_carbs_g,
      fat_g: raw.recipe_fat_g,
      fiber_g: raw.recipe_fiber_g,
    },
    ingredients: parseJson(raw.ingredients_json, null),
  };
}

function insertMealFromResolved(db, userId, { date, name, meal_slot, time_min, weight_basis, resolved, totals }) {
  const result = { log_entry_ids: [], label_ingredient_ids: [] };
  const ingredientRows = [];

  for (const item of resolved) {
    if (item.kind === 'new_food') {
      const lid = createLabelFromNewFood(db, userId, item);
      result.label_ingredient_ids.push(lid);
      ingredientRows.push({
        name: item.name, amount: item.quantity_g, unit: 'g', label_ingredient_id: lid,
        calories: item.macros.calories, protein_g: item.macros.protein_g, carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g, fiber_g: item.macros.fiber_g, weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    } else if (item.kind === 'label_ingredient') {
      ingredientRows.push({
        name: item.name, amount: item.quantity_g, unit: 'g', label_ingredient_id: item.label_ingredient_id,
        calories: item.macros.calories, protein_g: item.macros.protein_g, carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g, fiber_g: item.macros.fiber_g, weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    } else if (item.kind === 'recipe') {
      ingredientRows.push({
        name: item.name, amount: item.servings, unit: 'serving', recipe_id: item.recipe_id,
        calories: item.macros.calories, protein_g: item.macros.protein_g, carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g, fiber_g: item.macros.fiber_g, weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    }
  }

  const onlyRecipe = resolved.length === 1 && resolved[0].kind === 'recipe' ? resolved[0] : null;
  if (onlyRecipe) {
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_quick_food
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(onlyRecipe.recipe_id, userId);
    if (!recipe) throw Object.assign(new Error('Recipe missing'), { code: 'RECIPE_GONE' });
    const ins = db
      .prepare(
        `INSERT INTO log_entries (
           user_id, recipe_id, date, time_min, servings, notes,
           recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g,
           recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, slot_selections_json,
           ingredients_json, source, weight_basis, nutrition_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'mcp', ?, ?)`
      )
      .run(
        userId, recipe.id, date, time_min, onlyRecipe.servings,
        meal_slot ? `slot:${meal_slot}` : null, recipe.name, recipe.serving_size,
        recipe.calories, recipe.protein_g, recipe.carbs_g, recipe.fat_g, recipe.fiber_g,
        recipe.is_quick_food ? 1 : 0, weight_basis, onlyRecipe.nutrition_source
      );
    result.log_entry_ids.push(ins.lastInsertRowid);
    return result;
  }

  const recipeId = ensureQuickFoodRecipe(db, userId, name, totals);
  const nutrition_source = resolved.every(i => i.nutrition_source === 'label')
    ? 'label'
    : resolved.every(i => i.nutrition_source === 'database')
      ? 'database'
      : resolved.some(i => i.nutrition_source === 'estimate')
        ? 'estimate'
        : 'database';

  const ins = db
    .prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g,
         recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, slot_selections_json,
         ingredients_json, source, weight_basis, nutrition_source
       ) VALUES (?, ?, ?, ?, 1, ?, ?, '1 serving', ?, ?, ?, ?, ?, 1, NULL, ?, 'mcp', ?, ?)`
    )
    .run(
      userId, recipeId, date, time_min, meal_slot ? `slot:${meal_slot}` : null, name,
      totals.calories, totals.protein_g, totals.carbs_g, totals.fat_g, totals.fiber_g,
      JSON.stringify(ingredientRows), weight_basis, nutrition_source
    );
  result.log_entry_ids.push(ins.lastInsertRowid);
  return result;
}

function buildMealPayload(db, userId, args, refMap) {
  const date = isoDateOrNull(args.date) || getLocalDateISO();
  const weight_basis = normalizeWeightBasis(args.weight_basis);
  if (!weight_basis) return { error: 'weight_basis is required (raw|cooked)' };
  const itemsIn = Array.isArray(args.items) ? args.items : null;
  if (!itemsIn || !itemsIn.length) return { error: 'items must be a non-empty array' };

  const resolved = [];
  const warnings = [];
  for (let i = 0; i < itemsIn.length; i++) {
    const r = resolveMealItem(db, userId, itemsIn[i], weight_basis, i, refMap);
    if (r.error) return { error: r.error };
    resolved.push(r.item);
    warnings.push(...(r.warnings || []));
  }
  const totals = sumItemMacros(resolved);
  const meal_slot = args.meal_slot ? String(args.meal_slot).trim() : null;
  const name = String(args.name || '').trim() || (meal_slot ? `${meal_slot} meal` : 'MCP meal');
  const time_min = args.time_min == null || args.time_min === '' ? null : Number(args.time_min);
  if (time_min != null && (!Number.isFinite(time_min) || time_min < 0 || time_min > 1439)) {
    return { error: 'time_min must be minutes from midnight (0–1439)' };
  }
  return { date, name, meal_slot, time_min, weight_basis, resolved, totals, warnings };
}

function daySlice(day) {
  return {
    date: day.date,
    meal_totals: day.meal_totals,
    combined_totals: day.combined_totals,
    vs_goals: day.vs_goals,
    meals: day.meals,
  };
}

function logMeal(db, userId, args = {}, { refMap = null, skipAudit = false } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const built = buildMealPayload(db, userId, args, refMap);
    if (built.error) return { error: built.error };

    const doWrite = () => {
      const ids = insertMealFromResolved(db, userId, built);
      const entry = fetchLogEntryById(db, userId, ids.log_entry_ids[0]);
      const day = reads.getDay(db, userId, built.date);
      const response = {
        op: OPS.log_meal,
        entry,
        day: daySlice(day),
        result_row_ids: ids,
        warnings: built.warnings,
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.log_meal, operationId, before: null, after: entry,
          result_row_ids: ids, warnings: built.warnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function getFoodRow(db, userId, id) {
  return db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, fiber_g, micros_json,
              created_via, weight_basis, nutrition_source, source_type, tracking_type
         FROM label_ingredients WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
}

function addFoodItem(db, userId, args = {}, { skipAudit = false, refMap = null } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const name = String(args.name || '').trim();
    if (!name) return { error: 'name is required' };
    const weight_basis = normalizeWeightBasis(args.weight_basis);
    if (!weight_basis) return { error: 'weight_basis is required (raw|cooked)' };
    const nutrition_source = normalizeNutritionSource(args.nutrition_source);
    if (!nutrition_source) return { error: 'nutrition_source must be label|database|estimate' };

    const per100 = {
      calories: Number(args.calories_per_100g),
      protein_g: Number(args.protein_g_per_100g),
      carbs_g: Number(args.carbs_g_per_100g),
      fat_g: Number(args.fat_g_per_100g),
      fiber_g: args.fiber_g_per_100g == null || args.fiber_g_per_100g === '' ? null : Number(args.fiber_g_per_100g),
    };
    if (![per100.calories, per100.protein_g, per100.carbs_g, per100.fat_g].every(Number.isFinite)) {
      return { error: 'per-100g macros are required' };
    }

    const serving_size_text = String(args.serving_size_text || '').trim() || '100 g';
    const grams_per_serving =
      args.grams_per_serving != null && Number.isFinite(Number(args.grams_per_serving))
        ? Number(args.grams_per_serving)
        : 100;
    const brand_name = args.brand_name ? String(args.brand_name).trim() : null;
    const similar = searchSimilarIngredients(db, userId, name);
    const warnings = similar.length ? [`Found ${similar.length} similar library item(s) for "${name}".`] : [];
    const scale = grams_per_serving / 100;
    const servingMacros = {
      calories: round(per100.calories * scale, 1),
      protein_g: round(per100.protein_g * scale, 2),
      carbs_g: round(per100.carbs_g * scale, 2),
      fat_g: round(per100.fat_g * scale, 2),
      fiber_g: per100.fiber_g == null ? null : round(per100.fiber_g * scale, 2),
    };
    const micros =
      args.micros_per_100g && typeof args.micros_per_100g === 'object'
        ? JSON.stringify({
            micros: Object.fromEntries(
              Object.entries(args.micros_per_100g).map(([k, v]) => [k, round(Number(v) * scale, 3)])
            ),
            confidence: 'medium',
          })
        : null;

    const doWrite = () => {
      const r = db
        .prepare(
          `INSERT INTO label_ingredients (
             user_id, name, base_label, brand_name, serving_size_text, grams_per_serving,
             calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri, source_type,
             use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit,
             barcode, micros_json, created_via, weight_basis, nutrition_source
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'manual',
                     0, NULL, 'weight', NULL, NULL, NULL, NULL, ?, 'mcp', ?, ?)`
        )
        .run(
          userId, name, brand_name, serving_size_text, grams_per_serving,
          servingMacros.calories, servingMacros.protein_g, servingMacros.carbs_g,
          servingMacros.fat_g, servingMacros.fiber_g, micros, weight_basis, nutrition_source
        );
      const id = r.lastInsertRowid;
      if (refMap && args.ref) refMap.set(String(args.ref), id);
      const food = getFoodRow(db, userId, id);
      const result_row_ids = { label_ingredient_ids: [id] };
      const response = {
        op: OPS.add_food_item,
        label_ingredient_id: id,
        food,
        similar_library_items: similar,
        result_row_ids,
        warnings,
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.add_food_item, operationId, before: null, after: food,
          result_row_ids, warnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateFoodItem(db, userId, args = {}, { skipAudit = false } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.label_ingredient_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'label_ingredient_id is required' };
    const before = getFoodRow(db, userId, id);
    if (!before) return { error: `label_ingredient_id ${id} not found` };

    const patch = { ...before };
    if (args.name != null) patch.name = String(args.name).trim();
    if (args.brand_name !== undefined) patch.brand_name = args.brand_name ? String(args.brand_name).trim() : null;
    if (args.serving_size_text != null) patch.serving_size_text = String(args.serving_size_text).trim();
    if (args.grams_per_serving != null) patch.grams_per_serving = Number(args.grams_per_serving);
    if (args.calories != null) patch.calories = Number(args.calories);
    if (args.protein_g != null) patch.protein_g = Number(args.protein_g);
    if (args.carbs_g != null) patch.carbs_g = Number(args.carbs_g);
    if (args.fat_g != null) patch.fat_g = Number(args.fat_g);
    if (args.fiber_g !== undefined) {
      patch.fiber_g = args.fiber_g == null || args.fiber_g === '' ? null : Number(args.fiber_g);
    }
    if (args.weight_basis != null) {
      const wb = normalizeWeightBasis(args.weight_basis);
      if (!wb) return { error: 'weight_basis must be raw|cooked' };
      patch.weight_basis = wb;
    }
    if (args.nutrition_source != null) {
      const ns = normalizeNutritionSource(args.nutrition_source);
      if (!ns) return { error: 'nutrition_source must be label|database|estimate' };
      patch.nutrition_source = ns;
    }
    if (!patch.name || !patch.serving_size_text) return { error: 'name and serving_size_text cannot be empty' };

    const doWrite = () => {
      db.prepare(
        `UPDATE label_ingredients
            SET name = ?, brand_name = ?, serving_size_text = ?, grams_per_serving = ?,
                calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
                weight_basis = ?, nutrition_source = ?
          WHERE id = ? AND user_id = ?`
      ).run(
        patch.name, patch.brand_name, patch.serving_size_text, patch.grams_per_serving,
        patch.calories, patch.protein_g, patch.carbs_g, patch.fat_g, patch.fiber_g,
        patch.weight_basis, patch.nutrition_source, id, userId
      );
      const after = getFoodRow(db, userId, id);
      const result_row_ids = { label_ingredient_ids: [id] };
      const response = { op: OPS.update_food_item, before, after, result_row_ids, warnings: [] };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.update_food_item, operationId, before, after, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateMealEntry(db, userId, args = {}, { skipAudit = false } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.log_entry_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'log_entry_id is required' };
    const before = fetchLogEntryById(db, userId, id);
    if (!before) return { error: `log_entry_id ${id} not found` };

    const hasItems = Array.isArray(args.items);
    const date = args.date ? isoDateOrNull(args.date) : before.date;
    if (args.date && !date) return { error: 'date must be YYYY-MM-DD' };
    const meal_slot =
      args.meal_slot !== undefined
        ? String(args.meal_slot || '').trim() || null
        : before.notes?.startsWith('slot:')
          ? before.notes.slice(5)
          : null;
    const time_min = args.time_min !== undefined ? Number(args.time_min) : before.time_min;
    const weight_basis =
      args.weight_basis != null
        ? normalizeWeightBasis(args.weight_basis)
        : before.weight_basis || 'cooked';
    if (args.weight_basis != null && !weight_basis) return { error: 'weight_basis must be raw|cooked' };
    const name = args.name != null ? String(args.name).trim() : before.recipe_name;

    let resolved = null;
    let totals = null;
    let warnings = [];
    if (hasItems) {
      const built = buildMealPayload(db, userId, {
        date, name, meal_slot, time_min, weight_basis, items: args.items,
      }, null);
      if (built.error) return { error: built.error };
      resolved = built.resolved;
      totals = built.totals;
      warnings = built.warnings;
    }

    const doWrite = () => {
      if (hasItems) {
        db.prepare('DELETE FROM log_entries WHERE id = ? AND user_id = ?').run(id, userId);
        const ids = insertMealFromResolved(db, userId, {
          date, name, meal_slot, time_min, weight_basis, resolved, totals,
        });
        const after = fetchLogEntryById(db, userId, ids.log_entry_ids[0]);
        const result_row_ids = {
          log_entry_ids: ids.log_entry_ids,
          replaced_log_entry_id: id,
          label_ingredient_ids: ids.label_ingredient_ids,
        };
        const response = {
          op: OPS.update_meal_entry, before, after, result_row_ids, warnings,
          note: 'Item changes create a new log_entry_id; previous id was removed.',
        };
        if (!skipAudit) {
          response.audit_id = recordAudit(db, userId, {
            op: OPS.update_meal_entry, operationId, before, after, result_row_ids, warnings, response,
          });
        }
        return response;
      }

      db.prepare(
        `UPDATE log_entries SET date = ?, time_min = ?, notes = ?, recipe_name = ?, weight_basis = ?
          WHERE id = ? AND user_id = ?`
      ).run(date, time_min, meal_slot ? `slot:${meal_slot}` : null, name, weight_basis, id, userId);
      const after = fetchLogEntryById(db, userId, id);
      const result_row_ids = { log_entry_ids: [id] };
      const response = { op: OPS.update_meal_entry, before, after, result_row_ids, warnings: [] };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.update_meal_entry, operationId, before, after, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteMealEntry(db, userId, args = {}, { skipAudit = false } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.log_entry_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'log_entry_id is required' };
    const before = fetchLogEntryById(db, userId, id);
    if (!before) return { error: `log_entry_id ${id} not found` };

    const doWrite = () => {
      db.prepare('DELETE FROM log_entries WHERE id = ? AND user_id = ?').run(id, userId);
      const result_row_ids = { deleted_log_entry_ids: [id] };
      const response = {
        op: OPS.delete_meal_entry, before, after: null, result_row_ids, warnings: [],
        permanent: true, message: 'Hard delete — not revertible.',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.delete_meal_entry, operationId, before, after: null, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function shapeSupplement(db, userId, id) {
  const row = db
    .prepare(
      `SELECT id, name, dose_text, label_serving_qty, label_serving_unit, dose_qty,
              calories, protein_g, carbs_g, fat_g, created_via
         FROM supplements WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return null;
  return {
    ...row,
    dose_multiplier: doseMultiplier({
      label_serving_qty: row.label_serving_qty,
      dose_qty: row.dose_qty,
    }),
  };
}

function updateSupplement(db, userId, args = {}, { skipAudit = false } = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.supplement_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'supplement_id is required' };
    const before = shapeSupplement(db, userId, id);
    if (!before) return { error: `supplement_id ${id} not found` };

    const afterDose = {
      dose_text: args.dose_text !== undefined ? String(args.dose_text || '').trim() || null : before.dose_text,
      dose_qty: args.dose_qty !== undefined ? Number(args.dose_qty) : before.dose_qty,
      label_serving_qty:
        args.label_serving_qty !== undefined ? Number(args.label_serving_qty) : before.label_serving_qty,
      label_serving_unit:
        args.label_serving_unit !== undefined
          ? String(args.label_serving_unit || '').trim() || null
          : before.label_serving_unit,
    };
    if (args.dose_qty !== undefined && (!Number.isFinite(afterDose.dose_qty) || afterDose.dose_qty <= 0)) {
      return { error: 'dose_qty must be a positive number' };
    }
    if (
      args.label_serving_qty !== undefined &&
      (!Number.isFinite(afterDose.label_serving_qty) || afterDose.label_serving_qty <= 0)
    ) {
      return { error: 'label_serving_qty must be a positive number' };
    }

    const takenDate = args.taken_date ? isoDateOrNull(args.taken_date) : null;
    if (args.taken_date && !takenDate) return { error: 'taken_date must be YYYY-MM-DD' };
    const hasTaken = Object.prototype.hasOwnProperty.call(args, 'taken');

    const doWrite = () => {
      db.prepare(
        `UPDATE supplements
            SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?
          WHERE id = ? AND user_id = ?`
      ).run(
        afterDose.dose_text, afterDose.dose_qty, afterDose.label_serving_qty,
        afterDose.label_serving_unit, id, userId
      );

      let taken = null;
      if (hasTaken && takenDate) {
        db.prepare(
          `INSERT INTO supplement_log (user_id, date, supplement_id, taken, dose_qty)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(user_id, date, supplement_id) DO UPDATE SET taken = excluded.taken`
        ).run(userId, takenDate, id, args.taken ? 1 : 0);
        taken = { date: takenDate, taken: !!args.taken };
      }

      const after = shapeSupplement(db, userId, id);
      const result_row_ids = { supplement_ids: [id] };
      const response = { op: OPS.update_supplement, before, after, taken, result_row_ids, warnings: [] };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.update_supplement, operationId, before, after, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function writeBatch(db, userId, args = {}) {
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const ops = Array.isArray(args.operations) ? args.operations : null;
    if (!ops || !ops.length) return { error: 'operations must be a non-empty array' };

    try {
      const run = db.transaction(() => {
        const refMap = new Map();
        const results = [];
        for (let i = 0; i < ops.length; i++) {
          const step = { ...(ops[i] || {}) };
          delete step.operation_id; // batch-level idempotency only
          const op = String(step.op || '').trim();
          let result;
          if (op === OPS.add_food_item) {
            result = addFoodItem(db, userId, step, { skipAudit: true, refMap });
          } else if (op === OPS.log_meal) {
            result = logMeal(db, userId, step, { skipAudit: true, refMap });
          } else if (op === OPS.update_food_item) {
            result = updateFoodItem(db, userId, step, { skipAudit: true });
          } else if (op === OPS.update_meal_entry) {
            result = updateMealEntry(db, userId, step, { skipAudit: true });
          } else if (op === OPS.delete_meal_entry) {
            result = deleteMealEntry(db, userId, step, { skipAudit: true });
          } else if (op === OPS.update_supplement) {
            result = updateSupplement(db, userId, step, { skipAudit: true });
          } else {
            throw Object.assign(new Error(`operations[${i}]: unsupported op "${op}"`), { code: 'BAD_OP' });
          }
          if (result?.error) {
            throw Object.assign(new Error(`operations[${i}]: ${result.error}`), { code: 'OP_FAILED' });
          }
          results.push(result);
        }

        const response = {
          op: OPS.write_batch,
          results,
          refs: Object.fromEntries(refMap),
          warnings: results.flatMap(r => r.warnings || []),
        };
        const lastMeal = [...results].reverse().find(r => r.op === OPS.log_meal);
        if (lastMeal?.day) response.day = lastMeal.day;
        response.result_row_ids = {
          log_entry_ids: results.flatMap(r => r.result_row_ids?.log_entry_ids || []),
          label_ingredient_ids: results.flatMap(r => r.result_row_ids?.label_ingredient_ids || []),
          supplement_ids: results.flatMap(r => r.result_row_ids?.supplement_ids || []),
        };
        response.audit_id = recordAudit(db, userId, {
          op: OPS.write_batch,
          operationId,
          before: null,
          after: { refs: response.refs, results: results.map(r => ({ op: r.op, result_row_ids: r.result_row_ids })) },
          result_row_ids: response.result_row_ids,
          warnings: response.warnings,
          response,
        });
        return response;
      });
      return run();
    } catch (e) {
      return { error: e.message || 'write_batch failed' };
    }
  });
}

function listRecentMcpWrites(db, userId, daysRaw = 7) {
  const days = Math.min(90, Math.max(1, Number(daysRaw) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const sinceTs = new Date(Date.now() - days * 86400000).toISOString();

  const meals = db
    .prepare(
      `SELECT id, date, recipe_name AS name, recipe_calories AS calories,
              recipe_protein_g AS protein_g, recipe_carbs_g AS carbs_g, recipe_fat_g AS fat_g,
              source, weight_basis, nutrition_source, servings
         FROM log_entries
        WHERE user_id = ? AND source = 'mcp' AND date >= ?
        ORDER BY date DESC, id DESC`
    )
    .all(userId, since);

  const foods = db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, created_via, weight_basis, nutrition_source
         FROM label_ingredients
        WHERE user_id = ? AND created_via = 'mcp'
        ORDER BY id DESC LIMIT 100`
    )
    .all(userId);

  const audits = db
    .prepare(
      `SELECT id AS audit_id, kind, op, operation_id, created_at,
              before_json, after_json, result_row_ids_json, warnings_json, preview_json
         FROM mcp_write_audit
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT 100`
    )
    .all(userId, sinceTs)
    .map(a => ({
      audit_id: a.audit_id,
      op: a.op || a.kind,
      operation_id: a.operation_id || null,
      created_at: a.created_at,
      before: parseJson(a.before_json, null),
      after: parseJson(a.after_json, parseJson(a.preview_json, null)),
      result_row_ids: parseJson(a.result_row_ids_json, {}),
      warnings: parseJson(a.warnings_json, []),
    }));

  return { days, since, meals, foods, audits };
}

function bulkDeleteMcpLogEntries(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map(() => '?').join(',');
  const owned = db
    .prepare(`SELECT id FROM log_entries WHERE user_id = ? AND source = 'mcp' AND id IN (${placeholders})`)
    .all(userId, ...list)
    .map(r => r.id);
  if (!owned.length) return { deleted: 0, skipped: list.length };
  const ph2 = owned.map(() => '?').join(',');
  const r = db.prepare(`DELETE FROM log_entries WHERE user_id = ? AND id IN (${ph2})`).run(userId, ...owned);
  return { deleted: r.changes, ids: owned };
}

function bulkDeleteMcpFoods(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map(() => '?').join(',');
  const owned = db
    .prepare(`SELECT id FROM label_ingredients WHERE user_id = ? AND created_via = 'mcp' AND id IN (${placeholders})`)
    .all(userId, ...list)
    .map(r => r.id);
  if (!owned.length) return { deleted: 0 };
  const ph2 = owned.map(() => '?').join(',');
  const r = db.prepare(`DELETE FROM label_ingredients WHERE user_id = ? AND id IN (${ph2})`).run(userId, ...owned);
  return { deleted: r.changes, ids: owned };
}

module.exports = {
  OPS,
  logMeal,
  addFoodItem,
  updateFoodItem,
  updateMealEntry,
  deleteMealEntry,
  updateSupplement,
  writeBatch,
  listRecentMcpWrites,
  bulkDeleteMcpLogEntries,
  bulkDeleteMcpFoods,
  searchSimilarIngredients,
};
