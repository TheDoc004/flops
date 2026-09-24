/**
 * MCP write path: propose → (chat confirmation) → commit.
 *
 * Server cannot verify a human approved the write. Safety is: bad writes are
 * obvious (source=mcp), audited, and cheap to undo — not impossible.
 */
const crypto = require('crypto');
const { isoDateOrNull, getLocalDateISO } = require('./dates');

const PROPOSAL_TTL_MS = 60 * 60 * 1000;
const NUTRITION_SOURCES = new Set(['label', 'database', 'estimate']);
const WEIGHT_BASES = new Set(['raw', 'cooked']);
const KINDS = {
  meal_entry: 'meal_entry',
  food_item: 'food_item',
  supplement_correction: 'supplement_correction',
};

function nowIso() {
  return new Date().toISOString();
}

function plusMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function makeConfirmationCode(kind) {
  const prefix =
    kind === KINDS.meal_entry ? 'M' : kind === KINDS.food_item ? 'F' : 'S';
  const hex = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${hex}`;
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

function shapeProposalRow(row) {
  if (!row) return null;
  return {
    proposal_id: row.id,
    kind: row.kind,
    confirmation_code: row.confirmation_code,
    status: row.status,
    operation_id: row.operation_id || null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    committed_at: row.committed_at || null,
    preview: parseJson(row.preview_json, {}),
    warnings: parseJson(row.warnings_json, []),
    result_row_ids: parseJson(row.result_row_ids_json, null),
  };
}

function findByOperationId(db, userId, operationId) {
  if (!operationId) return null;
  return db
    .prepare(
      `SELECT * FROM mcp_proposals
        WHERE user_id = ? AND operation_id = ?
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, String(operationId));
}

function expireIfNeeded(db, row) {
  if (!row || row.status !== 'pending') return row;
  if (row.expires_at && row.expires_at < nowIso()) {
    db.prepare(
      `UPDATE mcp_proposals SET status = 'expired' WHERE id = ? AND status = 'pending'`
    ).run(row.id);
    return { ...row, status: 'expired' };
  }
  return row;
}

function insertProposal(db, userId, {
  kind,
  operationId,
  preview,
  payload,
  warnings = [],
}) {
  const id = makeId();
  const confirmation_code = makeConfirmationCode(kind);
  const created_at = nowIso();
  const expires_at = plusMsIso(PROPOSAL_TTL_MS);
  db.prepare(
    `INSERT INTO mcp_proposals (
       id, user_id, operation_id, kind, confirmation_code,
       preview_json, payload_json, warnings_json, status, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id,
    userId,
    operationId || null,
    kind,
    confirmation_code,
    JSON.stringify(preview),
    JSON.stringify(payload),
    JSON.stringify(warnings),
    created_at,
    expires_at
  );
  return shapeProposalRow(
    db.prepare('SELECT * FROM mcp_proposals WHERE id = ?').get(id)
  );
}

function idempotentOrCreate(db, userId, operationId, createFn) {
  if (operationId) {
    const existing = expireIfNeeded(db, findByOperationId(db, userId, operationId));
    if (existing) {
      const shaped = shapeProposalRow(existing);
      if (existing.status === 'committed') {
        return {
          ...shaped,
          idempotent: true,
          message: 'This operation_id was already committed; returning prior result.',
        };
      }
      if (existing.status === 'pending') {
        return {
          ...shaped,
          idempotent: true,
          message: 'Reusing existing pending proposal for this operation_id.',
        };
      }
      db.prepare(
        `UPDATE mcp_proposals SET operation_id = NULL WHERE id = ?`
      ).run(existing.id);
    }
  }
  return createFn();
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
    fiber_g:
      row.fiber_g == null ? null : round((Number(row.fiber_g) || 0) * f, 2),
  };
}

function resolveMealItem(db, userId, item, mealWeightBasis, index) {
  const warnings = [];
  const nutrition_source = normalizeNutritionSource(item?.nutrition_source);
  if (!nutrition_source) {
    return {
      error: `items[${index}].nutrition_source must be label|database|estimate`,
    };
  }
  const weight_basis =
    normalizeWeightBasis(item?.weight_basis) || mealWeightBasis;
  if (!weight_basis) {
    return { error: `items[${index}].weight_basis (or meal weight_basis) must be raw|cooked` };
  }

  const quantity_g = Number(item?.quantity_g);
  const servings = item?.servings != null ? Number(item.servings) : null;

  if (item?.label_ingredient_id != null) {
    const id = Number(item.label_ingredient_id);
    const row = db
      .prepare(
        `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
                calories, protein_g, carbs_g, fat_g, fiber_g, micros_json
           FROM label_ingredients WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return { error: `items[${index}]: label_ingredient_id ${id} not found` };
    if (!Number.isFinite(quantity_g) || quantity_g <= 0) {
      return { error: `items[${index}].quantity_g must be a positive number` };
    }
    const macros = scaleFromServing(row, quantity_g);
    if (!macros) {
      return {
        error: `items[${index}]: ingredient "${row.name}" needs grams_per_serving to scale by grams`,
      };
    }
    return {
      item: {
        kind: 'label_ingredient',
        label_ingredient_id: row.id,
        name: row.name,
        quantity_g,
        weight_basis,
        nutrition_source: nutrition_source === 'database' ? 'database' : nutrition_source,
        macros,
        micros: parseJson(row.micros_json, null),
      },
      warnings,
    };
  }

  if (item?.recipe_id != null) {
    const id = Number(item.recipe_id);
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_archived, is_deleted
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!recipe || recipe.is_deleted) {
      return { error: `items[${index}]: recipe_id ${id} not found` };
    }
    if (recipe.is_archived) {
      warnings.push(`Recipe "${recipe.name}" is archived; logging anyway if committed.`);
    }
    const s = Number.isFinite(servings) && servings > 0 ? servings : null;
    if (s == null) {
      return {
        error: `items[${index}]: recipe items need servings (positive number)`,
      };
    }
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
          fiber_g:
            recipe.fiber_g == null
              ? null
              : round((Number(recipe.fiber_g) || 0) * s, 2),
        },
        serving_size: recipe.serving_size,
      },
      warnings,
    };
  }

  const name = String(item?.name || '').trim();
  if (!name) {
    return {
      error: `items[${index}]: provide label_ingredient_id, recipe_id, or name (+ per-100g macros)`,
    };
  }
  if (!Number.isFinite(quantity_g) || quantity_g <= 0) {
    return { error: `items[${index}].quantity_g must be a positive number` };
  }
  const per100 = {
    calories: Number(item?.calories_per_100g),
    protein_g: Number(item?.protein_g_per_100g),
    carbs_g: Number(item?.carbs_g_per_100g),
    fat_g: Number(item?.fat_g_per_100g),
    fiber_g:
      item?.fiber_g_per_100g == null || item?.fiber_g_per_100g === ''
        ? null
        : Number(item.fiber_g_per_100g),
  };
  if (
    ![per100.calories, per100.protein_g, per100.carbs_g, per100.fat_g].every(
      Number.isFinite
    )
  ) {
    return {
      error: `items[${index}]: new items need calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g`,
    };
  }
  const similar = searchSimilarIngredients(db, userId, name);
  if (similar.length) {
    warnings.push(
      `Similar library items found for "${name}" — prefer linking label_ingredient_id to avoid duplicates.`
    );
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
      micros_per_100g: item?.micros_per_100g || null,
    },
    warnings,
  };
}

function proposeMealEntry(db, userId, args = {}) {
  const date = isoDateOrNull(args.date) || getLocalDateISO();
  const weight_basis = normalizeWeightBasis(args.weight_basis);
  if (!weight_basis) {
    return { error: 'weight_basis is required (raw|cooked)' };
  }
  const itemsIn = Array.isArray(args.items) ? args.items : null;
  if (!itemsIn || !itemsIn.length) {
    return { error: 'items must be a non-empty array' };
  }

  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return idempotentOrCreate(db, userId, operationId, () => {
    const resolved = [];
    const warnings = [];
    for (let i = 0; i < itemsIn.length; i++) {
      const r = resolveMealItem(db, userId, itemsIn[i], weight_basis, i);
      if (r.error) return { error: r.error };
      resolved.push(r.item);
      warnings.push(...(r.warnings || []));
    }

    const totals = resolved.reduce(
      (acc, it) => {
        acc.calories += it.macros.calories || 0;
        acc.protein_g += it.macros.protein_g || 0;
        acc.carbs_g += it.macros.carbs_g || 0;
        acc.fat_g += it.macros.fat_g || 0;
        if (it.macros.fiber_g != null) {
          acc.fiber_g = (acc.fiber_g || 0) + it.macros.fiber_g;
        }
        return acc;
      },
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null }
    );
    totals.calories = round(totals.calories, 1);
    totals.protein_g = round(totals.protein_g, 2);
    totals.carbs_g = round(totals.carbs_g, 2);
    totals.fat_g = round(totals.fat_g, 2);
    if (totals.fiber_g != null) totals.fiber_g = round(totals.fiber_g, 2);

    const meal_slot = args.meal_slot ? String(args.meal_slot).trim() : null;
    const name =
      String(args.name || '').trim() ||
      (meal_slot ? `${meal_slot} meal` : 'MCP meal');
    const time_min =
      args.time_min == null || args.time_min === ''
        ? null
        : Number(args.time_min);
    if (time_min != null && (!Number.isFinite(time_min) || time_min < 0 || time_min > 24 * 60 - 1)) {
      return { error: 'time_min must be minutes from midnight (0–1439)' };
    }

    const preview = {
      kind: KINDS.meal_entry,
      date,
      name,
      meal_slot,
      time_min,
      weight_basis,
      source: 'mcp',
      items: resolved,
      totals,
    };

    return insertProposal(db, userId, {
      kind: KINDS.meal_entry,
      operationId,
      preview,
      payload: preview,
      warnings,
    });
  });
}

function proposeFoodItem(db, userId, args = {}) {
  const name = String(args.name || '').trim();
  if (!name) return { error: 'name is required' };
  const weight_basis = normalizeWeightBasis(args.weight_basis);
  if (!weight_basis) return { error: 'weight_basis is required (raw|cooked)' };
  const nutrition_source = normalizeNutritionSource(args.nutrition_source);
  if (!nutrition_source) {
    return { error: 'nutrition_source must be label|database|estimate' };
  }

  const per100 = {
    calories: Number(args.calories_per_100g),
    protein_g: Number(args.protein_g_per_100g),
    carbs_g: Number(args.carbs_g_per_100g),
    fat_g: Number(args.fat_g_per_100g),
    fiber_g:
      args.fiber_g_per_100g == null || args.fiber_g_per_100g === ''
        ? null
        : Number(args.fiber_g_per_100g),
  };
  if (
    ![per100.calories, per100.protein_g, per100.carbs_g, per100.fat_g].every(
      Number.isFinite
    )
  ) {
    return {
      error:
        'calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g are required',
    };
  }

  const serving_size_text =
    String(args.serving_size_text || '').trim() || '100 g';
  const grams_per_serving =
    args.grams_per_serving != null && Number.isFinite(Number(args.grams_per_serving))
      ? Number(args.grams_per_serving)
      : 100;
  const brand_name = args.brand_name ? String(args.brand_name).trim() : null;
  const similar = searchSimilarIngredients(db, userId, name);
  const warnings = similar.length
    ? [
        `Found ${similar.length} similar library item(s). Prefer reusing an existing id unless you intend a new food.`,
      ]
    : [];

  const scale = grams_per_serving / 100;
  const servingMacros = {
    calories: round(per100.calories * scale, 1),
    protein_g: round(per100.protein_g * scale, 2),
    carbs_g: round(per100.carbs_g * scale, 2),
    fat_g: round(per100.fat_g * scale, 2),
    fiber_g:
      per100.fiber_g == null ? null : round(per100.fiber_g * scale, 2),
  };

  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return idempotentOrCreate(db, userId, operationId, () => {
    const preview = {
      kind: KINDS.food_item,
      name,
      brand_name,
      serving_size_text,
      grams_per_serving,
      weight_basis,
      nutrition_source,
      per_100g: per100,
      per_serving: servingMacros,
      similar_library_items: similar,
      source: 'mcp',
      micros_per_100g: args.micros_per_100g || null,
    };
    return insertProposal(db, userId, {
      kind: KINDS.food_item,
      operationId,
      preview,
      payload: preview,
      warnings,
    });
  });
}

function proposeSupplementCorrection(db, userId, args = {}) {
  const id = Number(args.supplement_id);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'supplement_id is required' };
  }
  const row = db
    .prepare(
      `SELECT id, name, dose_text, label_serving_qty, label_serving_unit, dose_qty,
              calories, protein_g, carbs_g, fat_g
         FROM supplements WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return { error: `supplement_id ${id} not found` };

  const hasDoseText = Object.prototype.hasOwnProperty.call(args, 'dose_text');
  const hasDoseQty = Object.prototype.hasOwnProperty.call(args, 'dose_qty');
  const hasLabelQty = Object.prototype.hasOwnProperty.call(args, 'label_serving_qty');
  const hasLabelUnit = Object.prototype.hasOwnProperty.call(args, 'label_serving_unit');
  if (!hasDoseText && !hasDoseQty && !hasLabelQty && !hasLabelUnit) {
    return {
      error:
        'Provide at least one of dose_text, dose_qty, label_serving_qty, label_serving_unit',
    };
  }

  const after = {
    dose_text: hasDoseText
      ? String(args.dose_text || '').trim() || null
      : row.dose_text,
    dose_qty: hasDoseQty ? Number(args.dose_qty) : row.dose_qty,
    label_serving_qty: hasLabelQty
      ? Number(args.label_serving_qty)
      : row.label_serving_qty,
    label_serving_unit: hasLabelUnit
      ? String(args.label_serving_unit || '').trim() || null
      : row.label_serving_unit,
  };
  if (hasDoseQty && (!Number.isFinite(after.dose_qty) || after.dose_qty <= 0)) {
    return { error: 'dose_qty must be a positive number' };
  }
  if (
    hasLabelQty &&
    (!Number.isFinite(after.label_serving_qty) || after.label_serving_qty <= 0)
  ) {
    return { error: 'label_serving_qty must be a positive number' };
  }

  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return idempotentOrCreate(db, userId, operationId, () => {
    const preview = {
      kind: KINDS.supplement_correction,
      supplement_id: row.id,
      name: row.name,
      before: {
        dose_text: row.dose_text,
        dose_qty: row.dose_qty,
        label_serving_qty: row.label_serving_qty,
        label_serving_unit: row.label_serving_unit,
      },
      after,
      source: 'mcp',
    };
    return insertProposal(db, userId, {
      kind: KINDS.supplement_correction,
      operationId,
      preview,
      payload: preview,
      warnings: [],
    });
  });
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
      `UPDATE recipes
          SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
              ingredients = '[]', recipe_kind = 'permanent', is_archived = 0,
              meal_builder_meta = NULL, is_quick_food = 1
        WHERE id = ? AND user_id = ?`
    ).run(
      macros.calories,
      macros.protein_g,
      macros.carbs_g,
      macros.fat_g,
      macros.fiber_g,
      existing.id,
      userId
    );
    return existing.id;
  }
  const r = db
    .prepare(
      `INSERT INTO recipes (
         user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g,
         ingredients, recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, is_quick_food
       ) VALUES (?, ?, '1 serving', ?, ?, ?, ?, ?, '[]', 'permanent', NULL, NULL, 0, NULL, 1)`
    )
    .run(
      userId,
      name,
      macros.calories,
      macros.protein_g,
      macros.carbs_g,
      macros.fat_g,
      macros.fiber_g
    );
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
      userId,
      item.name,
      per100.calories,
      per100.protein_g,
      per100.carbs_g,
      per100.fat_g,
      per100.fiber_g,
      micros,
      item.weight_basis,
      item.nutrition_source
    );
  return r.lastInsertRowid;
}

function commitMealEntry(db, userId, payload) {
  const result = { log_entry_ids: [], label_ingredient_ids: [] };
  const ingredientRows = [];

  for (const item of payload.items) {
    if (item.kind === 'new_food') {
      const lid = createLabelFromNewFood(db, userId, item);
      result.label_ingredient_ids.push(lid);
      ingredientRows.push({
        name: item.name,
        amount: item.quantity_g,
        unit: 'g',
        label_ingredient_id: lid,
        calories: item.macros.calories,
        protein_g: item.macros.protein_g,
        carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g,
        fiber_g: item.macros.fiber_g,
        weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    } else if (item.kind === 'label_ingredient') {
      ingredientRows.push({
        name: item.name,
        amount: item.quantity_g,
        unit: 'g',
        label_ingredient_id: item.label_ingredient_id,
        calories: item.macros.calories,
        protein_g: item.macros.protein_g,
        carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g,
        fiber_g: item.macros.fiber_g,
        weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    } else if (item.kind === 'recipe') {
      ingredientRows.push({
        name: item.name,
        amount: item.servings,
        unit: 'serving',
        recipe_id: item.recipe_id,
        calories: item.macros.calories,
        protein_g: item.macros.protein_g,
        carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g,
        fiber_g: item.macros.fiber_g,
        weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    }
  }

  const onlyRecipe =
    payload.items.length === 1 && payload.items[0].kind === 'recipe'
      ? payload.items[0]
      : null;

  if (onlyRecipe) {
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_quick_food
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(onlyRecipe.recipe_id, userId);
    if (!recipe) {
      throw Object.assign(new Error('Recipe missing at commit'), { code: 'RECIPE_GONE' });
    }
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
        userId,
        recipe.id,
        payload.date,
        payload.time_min,
        onlyRecipe.servings,
        payload.meal_slot ? `slot:${payload.meal_slot}` : null,
        recipe.name,
        recipe.serving_size,
        recipe.calories,
        recipe.protein_g,
        recipe.carbs_g,
        recipe.fat_g,
        recipe.fiber_g,
        recipe.is_quick_food ? 1 : 0,
        payload.weight_basis,
        onlyRecipe.nutrition_source
      );
    result.log_entry_ids.push(ins.lastInsertRowid);
    return result;
  }

  const macros = payload.totals;
  const recipeId = ensureQuickFoodRecipe(db, userId, payload.name, macros);
  const ingredients_json = JSON.stringify(ingredientRows);
  const nutrition_source =
    payload.items.every(i => i.nutrition_source === 'label')
      ? 'label'
      : payload.items.every(i => i.nutrition_source === 'database')
        ? 'database'
        : payload.items.some(i => i.nutrition_source === 'estimate')
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
      userId,
      recipeId,
      payload.date,
      payload.time_min,
      payload.meal_slot ? `slot:${payload.meal_slot}` : null,
      payload.name,
      macros.calories,
      macros.protein_g,
      macros.carbs_g,
      macros.fat_g,
      macros.fiber_g,
      ingredients_json,
      payload.weight_basis,
      nutrition_source
    );
  result.log_entry_ids.push(ins.lastInsertRowid);
  return result;
}

function commitFoodItem(db, userId, payload) {
  const scale = Number(payload.grams_per_serving) / 100;
  const micros =
    payload.micros_per_100g && typeof payload.micros_per_100g === 'object'
      ? JSON.stringify({
          micros: Object.fromEntries(
            Object.entries(payload.micros_per_100g).map(([k, v]) => [
              k,
              round(Number(v) * scale, 3),
            ])
          ),
          confidence: 'medium',
        })
      : null;
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
      userId,
      payload.name,
      payload.brand_name,
      payload.serving_size_text,
      payload.grams_per_serving,
      payload.per_serving.calories,
      payload.per_serving.protein_g,
      payload.per_serving.carbs_g,
      payload.per_serving.fat_g,
      payload.per_serving.fiber_g,
      micros,
      payload.weight_basis,
      payload.nutrition_source
    );
  return { label_ingredient_ids: [r.lastInsertRowid] };
}

function commitSupplementCorrection(db, userId, payload) {
  const after = payload.after;
  db.prepare(
    `UPDATE supplements
        SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    after.dose_text,
    after.dose_qty,
    after.label_serving_qty,
    after.label_serving_unit,
    payload.supplement_id,
    userId
  );
  return { supplement_ids: [payload.supplement_id] };
}

function commitProposal(db, userId, {
  proposal_id,
  confirmation_code,
  user_confirmation_text,
}) {
  const id = String(proposal_id || '').trim();
  const code = String(confirmation_code || '').trim().toUpperCase();
  const confirmText = String(user_confirmation_text || '').trim();
  if (!id) return { error: 'proposal_id is required' };
  if (!code) return { error: 'confirmation_code is required' };
  if (!confirmText) {
    return {
      error:
        'user_confirmation_text is required (verbatim user approval from the chat)',
    };
  }

  let row = db.prepare('SELECT * FROM mcp_proposals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { error: 'Proposal not found' };
  row = expireIfNeeded(db, row);

  if (row.status === 'committed') {
    return {
      ...shapeProposalRow(row),
      idempotent: true,
      message: 'Proposal already committed',
    };
  }
  if (row.status === 'discarded') return { error: 'Proposal was discarded' };
  if (row.status === 'expired') return { error: 'Proposal expired (proposals last 1 hour)' };
  if (row.status !== 'pending') return { error: `Proposal status is ${row.status}` };

  if (String(row.confirmation_code).toUpperCase() !== code) {
    return { error: 'confirmation_code does not match' };
  }

  const payload = parseJson(row.payload_json, null);
  if (!payload) return { error: 'Proposal payload corrupt' };

  let resultIds;
  try {
    const run = db.transaction(() => {
      let ids;
      if (row.kind === KINDS.meal_entry) ids = commitMealEntry(db, userId, payload);
      else if (row.kind === KINDS.food_item) ids = commitFoodItem(db, userId, payload);
      else if (row.kind === KINDS.supplement_correction) {
        ids = commitSupplementCorrection(db, userId, payload);
      } else {
        throw Object.assign(new Error(`Unknown kind ${row.kind}`), { code: 'BAD_KIND' });
      }

      db.prepare(
        `UPDATE mcp_proposals
            SET status = 'committed', committed_at = ?, result_row_ids_json = ?
          WHERE id = ? AND status = 'pending'`
      ).run(nowIso(), JSON.stringify(ids), id);

      db.prepare(
        `INSERT INTO mcp_write_audit (
           user_id, proposal_id, kind, confirmation_code, user_confirmation_text,
           preview_json, result_row_ids_json, operation_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        id,
        row.kind,
        row.confirmation_code,
        confirmText,
        row.preview_json,
        JSON.stringify(ids),
        row.operation_id,
        nowIso()
      );
      return ids;
    });
    resultIds = run();
  } catch (e) {
    return { error: e.message || 'Commit failed' };
  }

  const updated = db.prepare('SELECT * FROM mcp_proposals WHERE id = ?').get(id);
  return {
    ...shapeProposalRow(updated),
    result_row_ids: resultIds,
    committed: true,
  };
}

function discardProposal(db, userId, proposal_id) {
  const id = String(proposal_id || '').trim();
  if (!id) return { error: 'proposal_id is required' };
  let row = db.prepare('SELECT * FROM mcp_proposals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { error: 'Proposal not found' };
  row = expireIfNeeded(db, row);
  if (row.status === 'committed') {
    return { error: 'Cannot discard a committed proposal; delete the written rows instead' };
  }
  if (row.status === 'pending') {
    db.prepare(`UPDATE mcp_proposals SET status = 'discarded' WHERE id = ?`).run(id);
  }
  return shapeProposalRow(db.prepare('SELECT * FROM mcp_proposals WHERE id = ?').get(id));
}

function listProposals(db, userId, { include_expired = false } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM mcp_proposals
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50`
    )
    .all(userId)
    .map(r => expireIfNeeded(db, r));
  const filtered = include_expired
    ? rows
    : rows.filter(r => r.status === 'pending' || r.status === 'committed');
  return {
    proposals: filtered.map(shapeProposalRow),
  };
}

function listRecentMcpWrites(db, userId, daysRaw = 7) {
  const days = Math.min(90, Math.max(1, Number(daysRaw) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

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
        ORDER BY id DESC
        LIMIT 100`
    )
    .all(userId);

  const audits = db
    .prepare(
      `SELECT id, proposal_id, kind, confirmation_code, user_confirmation_text,
              preview_json, result_row_ids_json, created_at
         FROM mcp_write_audit
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 100`
    )
    .all(userId, new Date(Date.now() - days * 86400000).toISOString())
    .map(a => ({
      id: a.id,
      proposal_id: a.proposal_id,
      kind: a.kind,
      confirmation_code: a.confirmation_code,
      user_confirmation_text: a.user_confirmation_text,
      created_at: a.created_at,
      preview: parseJson(a.preview_json, {}),
      result_row_ids: parseJson(a.result_row_ids_json, {}),
    }));

  return {
    days,
    since,
    meals,
    foods,
    audits,
  };
}

function bulkDeleteMcpLogEntries(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map(() => '?').join(',');
  const owned = db
    .prepare(
      `SELECT id FROM log_entries
        WHERE user_id = ? AND source = 'mcp' AND id IN (${placeholders})`
    )
    .all(userId, ...list)
    .map(r => r.id);
  if (!owned.length) return { deleted: 0, skipped: list.length };
  const ph2 = owned.map(() => '?').join(',');
  const r = db
    .prepare(`DELETE FROM log_entries WHERE user_id = ? AND id IN (${ph2})`)
    .run(userId, ...owned);
  return { deleted: r.changes, ids: owned };
}

function bulkDeleteMcpFoods(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map(() => '?').join(',');
  const owned = db
    .prepare(
      `SELECT id FROM label_ingredients
        WHERE user_id = ? AND created_via = 'mcp' AND id IN (${placeholders})`
    )
    .all(userId, ...list)
    .map(r => r.id);
  if (!owned.length) return { deleted: 0 };
  const ph2 = owned.map(() => '?').join(',');
  const r = db
    .prepare(`DELETE FROM label_ingredients WHERE user_id = ? AND id IN (${ph2})`)
    .run(userId, ...owned);
  return { deleted: r.changes, ids: owned };
}

module.exports = {
  PROPOSAL_TTL_MS,
  KINDS,
  proposeMealEntry,
  proposeFoodItem,
  proposeSupplementCorrection,
  commitProposal,
  discardProposal,
  listProposals,
  listRecentMcpWrites,
  bulkDeleteMcpLogEntries,
  bulkDeleteMcpFoods,
  searchSimilarIngredients,
};
