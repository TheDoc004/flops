/**
 * MCP domain mutates beyond the Phase-3 meal/food core in writes.js.
 * All ops bind to the closed-over MCP userId — never trust client user ids.
 */
const { isoDateOrNull, getLocalDateISO } = require('./dates');
const { normalizeIngredientsBody } = require('../recipeIngredients');
const { buildMicrosBlob } = require('../microNutrients');
const { parseServingText } = require('../supplementDose');
const {
  recordAudit,
  withIdempotency,
  nowIso,
} = require('./writes');
const reads = require('./reads');

const OPS = {
  create_recipe: 'create_recipe',
  update_recipe: 'update_recipe',
  delete_recipe: 'delete_recipe',
  reactivate_recipe: 'reactivate_recipe',
  create_supplement: 'create_supplement',
  delete_supplement: 'delete_supplement',
  delete_food_item: 'delete_food_item',
  upsert_goals: 'upsert_goals',
  update_profile: 'update_profile',
  upsert_body_weight: 'upsert_body_weight',
  delete_body_weight: 'delete_body_weight',
  create_gym_exercise: 'create_gym_exercise',
  create_gym_template: 'create_gym_template',
  update_gym_template: 'update_gym_template',
  delete_gym_template: 'delete_gym_template',
  add_template_exercise: 'add_template_exercise',
  update_template_exercise: 'update_template_exercise',
  delete_template_exercise: 'delete_template_exercise',
  upsert_gym_schedule: 'upsert_gym_schedule',
  create_gym_session: 'create_gym_session',
  update_gym_session: 'update_gym_session',
  add_gym_set: 'add_gym_set',
  delete_gym_set: 'delete_gym_set',
  upsert_one_rm: 'upsert_one_rm',
};

const ALLOWED = {
  [OPS.create_recipe]: new Set([
    'op', 'name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    'ingredients', 'meal_builder_meta', 'recipe_kind', 'remaining_uses', 'max_uses',
    'is_archived', 'operation_id',
  ]),
  [OPS.update_recipe]: new Set([
    'op', 'recipe_id', 'name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    'ingredients', 'meal_builder_meta', 'recipe_kind', 'remaining_uses', 'max_uses',
    'is_archived', 'operation_id',
  ]),
  [OPS.delete_recipe]: new Set(['op', 'recipe_id', 'operation_id']),
  [OPS.reactivate_recipe]: new Set(['op', 'recipe_id', 'remaining_uses', 'max_uses', 'operation_id']),
  [OPS.create_supplement]: new Set([
    'op', 'name', 'dose_text', 'dose_qty', 'label_serving_qty', 'label_serving_unit',
    'calories', 'protein_g', 'carbs_g', 'fat_g', 'micros', 'counts_toward_macros', 'operation_id',
  ]),
  [OPS.delete_supplement]: new Set(['op', 'supplement_id', 'operation_id']),
  [OPS.delete_food_item]: new Set(['op', 'label_ingredient_id', 'operation_id']),
  [OPS.upsert_goals]: new Set(['op', 'effective_start_date', 'goals', 'operation_id']),
  [OPS.update_profile]: new Set([
    'op', 'height_cm', 'weight_kg', 'age', 'sex', 'goal_weight_kg', 'activity_level',
    'maintenance_calories', 'macro_units', 'body_units', 'dash_weight_chart_enabled',
    'dash_weight_days', 'dash_adherence_view', 'dash_supplements_enabled',
    'dash_training_fuel_enabled', 'dash_layout_json', 'dash_weight_enabled',
    'dash_meals_enabled', 'dash_weight_chart_card_enabled', 'digestion_pref',
    'training_goal', 'operation_id',
  ]),
  [OPS.upsert_body_weight]: new Set(['op', 'date', 'weight_kg', 'operation_id']),
  [OPS.delete_body_weight]: new Set(['op', 'date', 'operation_id']),
  [OPS.create_gym_exercise]: new Set([
    'op', 'name', 'primary_muscle', 'movement_type', 'equipment', 'rest_sec', 'operation_id',
  ]),
  [OPS.create_gym_template]: new Set([
    'op', 'name', 'split_label', 'notes', 'progression_notes', 'operation_id',
  ]),
  [OPS.update_gym_template]: new Set([
    'op', 'template_id', 'name', 'split_label', 'notes', 'progression_notes', 'operation_id',
  ]),
  [OPS.delete_gym_template]: new Set(['op', 'template_id', 'operation_id']),
  [OPS.add_template_exercise]: new Set([
    'op', 'template_id', 'exercise_id', 'name', 'target_sets', 'target_reps',
    'target_weight', 'rest_sec', 'notes', 'operation_id',
  ]),
  [OPS.update_template_exercise]: new Set([
    'op', 'template_id', 'item_id', 'target_sets', 'target_reps', 'target_weight',
    'rest_sec', 'notes', 'sort_order', 'operation_id',
  ]),
  [OPS.delete_template_exercise]: new Set(['op', 'template_id', 'item_id', 'operation_id']),
  [OPS.upsert_gym_schedule]: new Set(['op', 'days', 'operation_id']),
  [OPS.create_gym_session]: new Set([
    'op', 'date', 'activity_type', 'template_id', 'notes', 'operation_id',
  ]),
  [OPS.update_gym_session]: new Set([
    'op', 'session_id', 'finish', 'ended_at', 'duration_sec', 'activity_type', 'notes', 'operation_id',
  ]),
  [OPS.add_gym_set]: new Set([
    'op', 'session_id', 'exercise_id', 'reps', 'weight', 'weight_unit', 'is_warmup',
    'is_1rm', 'note', 'operation_id',
  ]),
  [OPS.delete_gym_set]: new Set(['op', 'session_id', 'set_id', 'operation_id']),
  [OPS.upsert_one_rm]: new Set([
    'op', 'exercise_id', 'estimated', 'tested', 'formula', 'operation_id',
  ]),
};

function reject(args, op) {
  const allowed = ALLOWED[op];
  if (!allowed) return { error: `Unknown op ${op}` };
  const unknown = Object.keys(args || {}).filter((k) => !allowed.has(k));
  if (!unknown.length) return null;
  return {
    error:
      `${op} does not accept parameter(s): ${unknown.join(', ')}. ` +
      `Unknown fields are refused (not ignored) so a write cannot look successful while dropping data.`,
    code: 'UNKNOWN_PARAM',
    unknown,
  };
}

function auditWrap(db, userId, op, operationId, before, after, result_row_ids, response, skipAudit) {
  if (!skipAudit) {
    response.audit_id = recordAudit(db, userId, {
      op,
      operationId,
      before,
      after,
      result_row_ids,
      warnings: [],
      response,
    });
  }
  return response;
}

function shapeRecipe(db, userId, id) {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  let ingredients = [];
  try {
    ingredients = row.ingredients ? JSON.parse(row.ingredients) : [];
  } catch {
    ingredients = [];
  }
  let meal_builder_meta = null;
  try {
    meal_builder_meta = row.meal_builder_meta ? JSON.parse(row.meal_builder_meta) : null;
  } catch {
    meal_builder_meta = null;
  }
  const { micros_json, micros_fingerprint, ...rest } = row;
  return { ...rest, ingredients, meal_builder_meta, is_archived: row.is_archived ? 1 : 0 };
}

function normalizeRecipeKind(raw) {
  if (raw == null || raw === '') return 'permanent';
  return String(raw).toLowerCase() === 'limited' ? 'limited' : 'permanent';
}

function normalizeLimitedUses(recipe_kind, rawRemaining, rawMax) {
  if (recipe_kind !== 'limited') return { remaining_uses: null, max_uses: null };
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

function validateIngredients(db, userId, body) {
  const ing = normalizeIngredientsBody(body);
  if (!ing.ok) {
    return {
      error:
        'ingredients must be library lines { kind:"ingredient", name, amount, unit, label_ingredient_id } and/or free-text { name, amount }',
    };
  }
  const checkLi = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = ?');
  for (const item of ing.value) {
    if (item.kind === 'ingredient' && !checkLi.get(item.label_ingredient_id, userId)) {
      return { error: `Unknown label ingredient id: ${item.label_ingredient_id}` };
    }
  }
  return { value: ing.value };
}

function createRecipe(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.create_recipe);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = args;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return { error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' };
    }
    const ing = validateIngredients(db, userId, args);
    if (ing.error) return ing;
    let metaJson = null;
    if (Object.prototype.hasOwnProperty.call(args, 'meal_builder_meta')) {
      if (args.meal_builder_meta != null && typeof args.meal_builder_meta !== 'object') {
        return { error: 'meal_builder_meta must be a JSON object or null' };
      }
      metaJson = args.meal_builder_meta == null ? null : JSON.stringify(args.meal_builder_meta);
    }
    const recipe_kind = normalizeRecipeKind(args.recipe_kind);
    const lim = normalizeLimitedUses(recipe_kind, args.remaining_uses ?? args.max_uses, args.max_uses);
    if (lim.error) return { error: lim.error };
    const is_archived = args.is_archived === true || args.is_archived === 1 ? 1 : 0;

    const doWrite = () => {
      const r = db
        .prepare(
          `INSERT INTO recipes (
            user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
            recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          String(name),
          String(serving_size),
          Number(calories),
          Number(protein_g),
          Number(carbs_g),
          Number(fat_g),
          fiber_g != null ? Number(fiber_g) : null,
          JSON.stringify(ing.value),
          recipe_kind,
          lim.remaining_uses,
          lim.max_uses,
          is_archived,
          metaJson,
          nowIso()
        );
      const after = shapeRecipe(db, userId, r.lastInsertRowid);
      const result_row_ids = { recipe_ids: [after.id] };
      const response = { op: OPS.create_recipe, recipe: after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.create_recipe, operationId, null, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateRecipe(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.update_recipe);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.recipe_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'recipe_id is required' };
    const before = shapeRecipe(db, userId, id);
    if (!before) return { error: `recipe_id ${id} not found` };

    const name = args.name !== undefined ? args.name : before.name;
    const serving_size = args.serving_size !== undefined ? args.serving_size : before.serving_size;
    const calories = args.calories !== undefined ? args.calories : before.calories;
    const protein_g = args.protein_g !== undefined ? args.protein_g : before.protein_g;
    const carbs_g = args.carbs_g !== undefined ? args.carbs_g : before.carbs_g;
    const fat_g = args.fat_g !== undefined ? args.fat_g : before.fat_g;
    const fiber_g = args.fiber_g !== undefined ? args.fiber_g : before.fiber_g;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return { error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' };
    }

    let ingredientsJson = before.ingredients != null ? JSON.stringify(before.ingredients) : '[]';
    if (Object.prototype.hasOwnProperty.call(args, 'ingredients')) {
      const ing = validateIngredients(db, userId, args);
      if (ing.error) return ing;
      ingredientsJson = JSON.stringify(ing.value);
    }

    let mealBuilderJson =
      before.meal_builder_meta == null ? null : JSON.stringify(before.meal_builder_meta);
    if (Object.prototype.hasOwnProperty.call(args, 'meal_builder_meta')) {
      if (args.meal_builder_meta != null && typeof args.meal_builder_meta !== 'object') {
        return { error: 'meal_builder_meta must be a JSON object or null' };
      }
      mealBuilderJson = args.meal_builder_meta == null ? null : JSON.stringify(args.meal_builder_meta);
    }

    const recipe_kind =
      args.recipe_kind !== undefined ? normalizeRecipeKind(args.recipe_kind) : before.recipe_kind || 'permanent';
    let remaining_uses = before.remaining_uses;
    let max_uses = before.max_uses;
    if (recipe_kind === 'limited') {
      if (args.remaining_uses !== undefined || args.max_uses !== undefined) {
        const lim = normalizeLimitedUses(
          recipe_kind,
          args.remaining_uses ?? before.remaining_uses,
          args.max_uses ?? before.max_uses
        );
        if (lim.error) return { error: lim.error };
        remaining_uses = lim.remaining_uses;
        max_uses = lim.max_uses;
      }
    } else {
      remaining_uses = null;
      max_uses = null;
    }
    let is_archived = before.is_archived ? 1 : 0;
    if (args.is_archived !== undefined) {
      is_archived = args.is_archived === true || args.is_archived === 1 ? 1 : 0;
    }

    const doWrite = () => {
      db.prepare(
        `UPDATE recipes SET name=?, serving_size=?, calories=?, protein_g=?, carbs_g=?, fat_g=?, fiber_g=?, ingredients=?,
          recipe_kind=?, remaining_uses=?, max_uses=?, is_archived=?, meal_builder_meta=?
         WHERE id=? AND user_id=?`
      ).run(
        String(name),
        String(serving_size),
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
        id,
        userId
      );
      const after = shapeRecipe(db, userId, id);
      const result_row_ids = { recipe_ids: [id] };
      const response = {
        op: OPS.update_recipe,
        before,
        after,
        result_row_ids,
        warnings: [],
        note: 'Editing a recipe does not rewrite past log_entries denormalized macros.',
      };
      return auditWrap(db, userId, OPS.update_recipe, operationId, before, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteRecipe(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_recipe);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.recipe_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'recipe_id is required' };
    const before = shapeRecipe(db, userId, id);
    if (!before) return { error: `recipe_id ${id} not found` };
    const doWrite = () => {
      db.prepare('UPDATE recipes SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(id, userId);
      const result_row_ids = { deleted_recipe_ids: [id] };
      const response = { op: OPS.delete_recipe, before, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.delete_recipe, operationId, before, null, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function reactivateRecipe(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.reactivate_recipe);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.recipe_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'recipe_id is required' };
    const before = shapeRecipe(db, userId, id);
    if (!before) return { error: `recipe_id ${id} not found` };
    if ((before.recipe_kind || 'permanent') !== 'limited') {
      return { error: 'Only limited-use templates can be reactivated this way' };
    }
    const n = Number(args.remaining_uses ?? args.max_uses);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      return { error: 'remaining_uses (or max_uses) must be integer 1–999' };
    }
    const doWrite = () => {
      db.prepare(
        `UPDATE recipes SET remaining_uses = ?, max_uses = ?, is_archived = 0 WHERE id = ? AND user_id = ?`
      ).run(n, n, id, userId);
      const after = shapeRecipe(db, userId, id);
      const result_row_ids = { recipe_ids: [id] };
      const response = { op: OPS.reactivate_recipe, before, after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.reactivate_recipe, operationId, before, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function doseFieldsFromArgs(args) {
  const parsedText = parseServingText(args?.dose_text);
  const rawLabelQty = Number(args?.label_serving_qty);
  const label_serving_qty =
    Number.isFinite(rawLabelQty) && rawLabelQty > 0 ? rawLabelQty : parsedText?.qty ?? 1;
  const label_serving_unit =
    (args?.label_serving_unit && String(args.label_serving_unit).trim()) || parsedText?.unit || 'serving';
  const rawDose = Number(args?.dose_qty);
  const dose_qty = Number.isFinite(rawDose) && rawDose > 0 ? rawDose : label_serving_qty;
  return { label_serving_qty, label_serving_unit, dose_qty };
}

function createSupplement(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.create_supplement);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const name = String(args.name ?? '').trim();
    if (!name) return { error: 'name is required' };
    const dose = doseFieldsFromArgs(args);
    const counts =
      args.counts_toward_macros === true || args.counts_toward_macros === 1 ? 1 : 0;
    let micros_json = null;
    if (args.micros != null) {
      const blob = buildMicrosBlob(args.micros, {
        confidence: 'high',
        notes: 'Created via MCP (label data)',
      });
      if (!blob) {
        return { error: 'micros contained no recognized nutrient keys with positive values' };
      }
      micros_json = JSON.stringify(blob);
    }
    const doWrite = () => {
      const nextSort = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM supplements WHERE user_id = ?')
        .get(userId).n;
      const r = db
        .prepare(
          `INSERT INTO supplements
             (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, sort_order,
              label_serving_qty, label_serving_unit, dose_qty, created_via)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mcp')`
        )
        .run(
          userId,
          name,
          args.dose_text != null ? String(args.dose_text).trim() || null : null,
          Number(args.calories) || 0,
          Number(args.protein_g) || 0,
          Number(args.carbs_g) || 0,
          Number(args.fat_g) || 0,
          counts,
          micros_json,
          nextSort,
          dose.label_serving_qty,
          dose.label_serving_unit,
          dose.dose_qty
        );
      const after = reads.listSupplements(db, userId, { include_deleted: true }).find(
        (s) => s.id === r.lastInsertRowid
      );
      const result_row_ids = { supplement_ids: [r.lastInsertRowid] };
      const response = { op: OPS.create_supplement, supplement: after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.create_supplement,
        operationId,
        null,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteSupplement(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_supplement);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.supplement_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'supplement_id is required' };
    const before = reads.listSupplements(db, userId, { include_deleted: true }).find((s) => s.id === id);
    if (!before) return { error: `supplement_id ${id} not found` };
    const doWrite = () => {
      db.prepare('UPDATE supplements SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(id, userId);
      const result_row_ids = { deleted_supplement_ids: [id] };
      const response = { op: OPS.delete_supplement, before, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.delete_supplement,
        operationId,
        before,
        null,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteFoodItem(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_food_item);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.label_ingredient_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'label_ingredient_id is required' };
    const before = db
      .prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?')
      .get(id, userId);
    if (!before) return { error: `label_ingredient_id ${id} not found` };
    const doWrite = () => {
      db.prepare('DELETE FROM label_ingredients WHERE id = ? AND user_id = ?').run(id, userId);
      const result_row_ids = { deleted_label_ingredient_ids: [id] };
      const response = {
        op: OPS.delete_food_item,
        before,
        result_row_ids,
        warnings: [],
        note: 'Hard-deleted (matches HTTP). Past meals that referenced this id keep denormalized macros.',
      };
      return auditWrap(
        db,
        userId,
        OPS.delete_food_item,
        operationId,
        before,
        null,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

const GOAL_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

function normalizeGoalNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeRangePair(goalRow, key) {
  const rawMin = goalRow?.[`${key}_min`];
  const rawMax = goalRow?.[`${key}_max`];
  const rawLegacy = goalRow?.[key];
  let min = normalizeGoalNumber(rawMin);
  let max = normalizeGoalNumber(rawMax);
  if (rawMin === undefined && rawMax === undefined && rawLegacy !== undefined) {
    const exact = normalizeGoalNumber(rawLegacy);
    min = exact;
    max = exact;
  }
  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;
  if (min != null && max != null && min > max) {
    return { error: `${key}_min must be less than or equal to ${key}_max` };
  }
  return { min, max };
}

function upsertGoals(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.upsert_goals);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const effectiveStartDate =
      isoDateOrNull(args.effective_start_date) || getLocalDateISO();
    if (!Array.isArray(args.goals)) return { error: 'goals must be an array' };
    const normalized = [];
    const seen = new Set();
    for (const g of args.goals) {
      const wd = Number(g?.weekday);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7) {
        return { error: 'Each goal needs weekday 1–7 (Mon–Sun)' };
      }
      if (seen.has(wd)) return { error: `Duplicate weekday ${wd}` };
      seen.add(wd);
      const row = { weekday: wd };
      for (const key of GOAL_FIELDS) {
        const pair = normalizeRangePair(g, key);
        if (pair.error) return pair;
        row[`${key}_min`] = pair.min;
        row[`${key}_max`] = pair.max;
      }
      normalized.push(row);
    }
    const before = reads.getGoalsForDate(db, userId, effectiveStartDate);
    const doWrite = () => {
      const upsert = db.prepare(`
        INSERT INTO day_goal_versions (
          user_id, effective_start_date, weekday,
          calories_min, calories_max, protein_g_min, protein_g_max,
          carbs_g_min, carbs_g_max, fat_g_min, fat_g_max
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, effective_start_date, weekday) DO UPDATE SET
          calories_min = excluded.calories_min, calories_max = excluded.calories_max,
          protein_g_min = excluded.protein_g_min, protein_g_max = excluded.protein_g_max,
          carbs_g_min = excluded.carbs_g_min, carbs_g_max = excluded.carbs_g_max,
          fat_g_min = excluded.fat_g_min, fat_g_max = excluded.fat_g_max
      `);
      for (const row of normalized) {
        upsert.run(
          userId,
          effectiveStartDate,
          row.weekday,
          row.calories_min,
          row.calories_max,
          row.protein_g_min,
          row.protein_g_max,
          row.carbs_g_min,
          row.carbs_g_max,
          row.fat_g_min,
          row.fat_g_max
        );
      }
      const after = reads.getGoalsForDate(db, userId, effectiveStartDate);
      const result_row_ids = { effective_start_date: effectiveStartDate };
      const response = { op: OPS.upsert_goals, before, after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.upsert_goals, operationId, before, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

const PROFILE_FIELDS = [
  'height_cm', 'weight_kg', 'age', 'sex', 'goal_weight_kg', 'activity_level',
  'maintenance_calories', 'macro_units', 'body_units', 'dash_weight_chart_enabled',
  'dash_weight_days', 'dash_adherence_view', 'dash_supplements_enabled',
  'dash_training_fuel_enabled', 'dash_layout_json', 'dash_weight_enabled',
  'dash_meals_enabled', 'dash_weight_chart_card_enabled', 'digestion_pref', 'training_goal',
];

function updateProfile(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.update_profile);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const before = reads.getProfile(db, userId);
    const patch = {};
    for (const key of PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(args, key)) patch[key] = args[key];
    }
    if (!Object.keys(patch).length) return { error: 'Provide at least one profile field to update' };

    const doWrite = () => {
      const existing = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId) || {
        user_id: userId,
        macro_units: 'metric',
        body_units: 'metric',
        dash_weight_chart_enabled: 1,
        dash_weight_days: 30,
        dash_adherence_view: '7d',
        dash_supplements_enabled: 1,
        dash_training_fuel_enabled: 1,
        dash_weight_enabled: 1,
        dash_meals_enabled: 1,
        dash_weight_chart_card_enabled: 0,
        digestion_pref: 'none',
        training_goal: 'performance',
      };
      const merged = { ...existing, ...patch, user_id: userId };
      if (merged.dash_layout_json != null && typeof merged.dash_layout_json === 'object') {
        merged.dash_layout_json = JSON.stringify(merged.dash_layout_json);
      }
      const bool01 = (v, def = 1) => {
        if (v === undefined || v === null || v === '') return def;
        return v === true || v === 1 || v === '1' ? 1 : 0;
      };
      db.prepare(`
        INSERT INTO user_profile (
          user_id, height_cm, weight_kg, age, sex, goal_weight_kg, activity_level, maintenance_calories,
          macro_units, body_units, dash_weight_chart_enabled, dash_weight_days, dash_adherence_view,
          dash_supplements_enabled, dash_training_fuel_enabled, dash_layout_json, dash_weight_enabled,
          dash_meals_enabled, dash_weight_chart_card_enabled, digestion_pref, training_goal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, age=excluded.age, sex=excluded.sex,
          goal_weight_kg=excluded.goal_weight_kg, activity_level=excluded.activity_level,
          maintenance_calories=excluded.maintenance_calories, macro_units=excluded.macro_units,
          body_units=excluded.body_units, dash_weight_chart_enabled=excluded.dash_weight_chart_enabled,
          dash_weight_days=excluded.dash_weight_days, dash_adherence_view=excluded.dash_adherence_view,
          dash_supplements_enabled=excluded.dash_supplements_enabled,
          dash_training_fuel_enabled=excluded.dash_training_fuel_enabled,
          dash_layout_json=excluded.dash_layout_json, dash_weight_enabled=excluded.dash_weight_enabled,
          dash_meals_enabled=excluded.dash_meals_enabled,
          dash_weight_chart_card_enabled=excluded.dash_weight_chart_card_enabled,
          digestion_pref=excluded.digestion_pref, training_goal=excluded.training_goal
      `).run(
        userId,
        merged.height_cm ?? null,
        merged.weight_kg ?? null,
        merged.age ?? null,
        merged.sex ?? null,
        merged.goal_weight_kg ?? null,
        merged.activity_level ?? null,
        merged.maintenance_calories ?? null,
        merged.macro_units === 'us' ? 'us' : 'metric',
        merged.body_units === 'us' ? 'us' : 'metric',
        bool01(merged.dash_weight_chart_enabled, 1),
        [14, 30, 90].includes(Number(merged.dash_weight_days)) ? Number(merged.dash_weight_days) : 30,
        ['7d', '2w', '3w', 'calendar'].includes(merged.dash_adherence_view)
          ? merged.dash_adherence_view
          : '7d',
        bool01(merged.dash_supplements_enabled, 1),
        bool01(merged.dash_training_fuel_enabled, 1),
        merged.dash_layout_json ?? null,
        bool01(merged.dash_weight_enabled, 1),
        bool01(merged.dash_meals_enabled, 1),
        bool01(merged.dash_weight_chart_card_enabled, 0),
        merged.digestion_pref || 'none',
        merged.training_goal || 'performance'
      );
      const after = reads.getProfile(db, userId);
      const result_row_ids = { user_id: userId };
      const response = { op: OPS.update_profile, before, after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.update_profile, operationId, before, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function upsertBodyWeight(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.upsert_body_weight);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const date = isoDateOrNull(args.date);
    if (!date) return { error: 'date must be YYYY-MM-DD' };
    const w = Number(args.weight_kg);
    if (!Number.isFinite(w) || w < 0) return { error: 'weight_kg must be a non-negative number' };
    const before =
      db.prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date = ?').get(userId, date) ||
      null;
    const doWrite = () => {
      db.prepare(
        `INSERT INTO body_weights (user_id, date, weight_kg) VALUES (?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`
      ).run(userId, date, w);
      const after = db
        .prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date = ?')
        .get(userId, date);
      const result_row_ids = { dates: [date] };
      const response = { op: OPS.upsert_body_weight, before, after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.upsert_body_weight,
        operationId,
        before,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteBodyWeight(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_body_weight);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const date = isoDateOrNull(args.date);
    if (!date) return { error: 'date must be YYYY-MM-DD' };
    const before = db
      .prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date = ?')
      .get(userId, date);
    if (!before) return { error: `No body weight on ${date}` };
    const doWrite = () => {
      db.prepare('DELETE FROM body_weights WHERE user_id = ? AND date = ?').run(userId, date);
      const result_row_ids = { deleted_dates: [date] };
      const response = { op: OPS.delete_body_weight, before, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.delete_body_weight,
        operationId,
        before,
        null,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

/* ─── Gym ─── */

const VALID_MUSCLES = new Set([
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes',
  'calves', 'core', 'full_body', 'other',
]);
const VALID_MOVEMENT = new Set(['push', 'pull', 'hinge', 'squat', 'carry', 'core', 'other']);

function trimStr(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function optInt(v, { min = 0, max = 1e9 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function optNum(v, { min = 0, max = 1e9 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function getGymTemplate(db, userId, id) {
  return db
    .prepare('SELECT * FROM gym_templates WHERE id = ? AND user_id = ? AND is_deleted = 0')
    .get(id, userId);
}

function getGymExercise(db, userId, id) {
  return db
    .prepare('SELECT * FROM gym_exercises WHERE id = ? AND is_deleted = 0 AND (user_id = 0 OR user_id = ?)')
    .get(id, userId);
}

function createGymExercise(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.create_gym_exercise);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const name = trimStr(args.name, 80);
    if (!name) return { error: 'name is required' };
    const primary = VALID_MUSCLES.has(args.primary_muscle) ? args.primary_muscle : 'other';
    const movement = VALID_MOVEMENT.has(args.movement_type) ? args.movement_type : 'other';
    const equipment = trimStr(args.equipment, 40);
    const rest_sec = optInt(args.rest_sec, { min: 0, max: 600 });
    const doWrite = () => {
      try {
        const r = db
          .prepare(
            `INSERT INTO gym_exercises (user_id, name, primary_muscle, secondary_muscles, movement_type, equipment, rest_sec)
             VALUES (?, ?, ?, '[]', ?, ?, ?)`
          )
          .run(userId, name, primary, movement, equipment, rest_sec);
        const after = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(r.lastInsertRowid);
        const result_row_ids = { exercise_ids: [after.id] };
        const response = { op: OPS.create_gym_exercise, exercise: after, result_row_ids, warnings: [] };
        return auditWrap(
          db,
          userId,
          OPS.create_gym_exercise,
          operationId,
          null,
          after,
          result_row_ids,
          response,
          skipAudit
        );
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
          const existing = db
            .prepare(
              `SELECT * FROM gym_exercises WHERE user_id = ? AND name = ? AND is_deleted = 0`
            )
            .get(userId, name);
          if (existing) {
            return {
              op: OPS.create_gym_exercise,
              exercise: existing,
              result_row_ids: { exercise_ids: [existing.id] },
              warnings: ['Existing exercise with that name returned'],
            };
          }
        }
        throw e;
      }
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function createGymTemplate(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.create_gym_template);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const name = trimStr(args.name, 80);
    if (!name) return { error: 'name is required' };
    const doWrite = () => {
      const r = db
        .prepare(
          `INSERT INTO gym_templates (user_id, name, split_label, notes, progression_notes)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          name,
          trimStr(args.split_label, 40),
          trimStr(args.notes, 800),
          trimStr(args.progression_notes, 800)
        );
      const after = db.prepare('SELECT * FROM gym_templates WHERE id = ?').get(r.lastInsertRowid);
      const result_row_ids = { template_ids: [after.id] };
      const response = { op: OPS.create_gym_template, template: after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.create_gym_template,
        operationId,
        null,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateGymTemplate(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.update_gym_template);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.template_id);
    const before = getGymTemplate(db, userId, id);
    if (!before) return { error: `template_id ${id} not found` };
    const name = args.name !== undefined ? trimStr(args.name, 80) : before.name;
    if (!name) return { error: 'name is required' };
    const doWrite = () => {
      db.prepare(
        `UPDATE gym_templates SET name=?, split_label=?, notes=?, progression_notes=?
          WHERE id=? AND user_id=?`
      ).run(
        name,
        args.split_label !== undefined ? trimStr(args.split_label, 40) : before.split_label,
        args.notes !== undefined ? trimStr(args.notes, 800) : before.notes,
        args.progression_notes !== undefined
          ? trimStr(args.progression_notes, 800)
          : before.progression_notes,
        id,
        userId
      );
      const after = db.prepare('SELECT * FROM gym_templates WHERE id = ?').get(id);
      const result_row_ids = { template_ids: [id] };
      const response = { op: OPS.update_gym_template, before, after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.update_gym_template,
        operationId,
        before,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteGymTemplate(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_gym_template);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.template_id);
    const before = getGymTemplate(db, userId, id);
    if (!before) return { error: `template_id ${id} not found` };
    const doWrite = () => {
      db.prepare('UPDATE gym_templates SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(id, userId);
      const result_row_ids = { deleted_template_ids: [id] };
      const response = { op: OPS.delete_gym_template, before, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.delete_gym_template,
        operationId,
        before,
        null,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function addTemplateExercise(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.add_template_exercise);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const templateId = Number(args.template_id);
    if (!getGymTemplate(db, userId, templateId)) return { error: `template_id ${templateId} not found` };
    let exerciseId = optInt(args.exercise_id, { min: 1, max: 1e9 });
    if (!exerciseId && args.name) {
      const name = trimStr(args.name, 80);
      let ex = db
        .prepare(
          `SELECT * FROM gym_exercises WHERE is_deleted = 0 AND name = ? AND (user_id = 0 OR user_id = ?)
           ORDER BY user_id DESC LIMIT 1`
        )
        .get(name, userId);
      if (!ex) {
        const ins = db
          .prepare(
            `INSERT INTO gym_exercises (user_id, name, primary_muscle, secondary_muscles, movement_type, equipment)
             VALUES (?, ?, 'other', '[]', 'other', '')`
          )
          .run(userId, name);
        ex = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(ins.lastInsertRowid);
      }
      exerciseId = ex.id;
    }
    if (!exerciseId || !getGymExercise(db, userId, exerciseId)) {
      return { error: 'exercise_id (or name) is required' };
    }
    const doWrite = () => {
      const maxSort = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM gym_template_exercises WHERE template_id = ?')
        .get(templateId).n;
      const r = db
        .prepare(
          `INSERT INTO gym_template_exercises
             (user_id, template_id, exercise_id, sort_order, target_sets, target_reps, target_weight, rest_sec, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          templateId,
          exerciseId,
          maxSort + 1,
          optInt(args.target_sets, { min: 0, max: 30 }),
          optInt(args.target_reps, { min: 0, max: 200 }),
          optNum(args.target_weight, { min: 0, max: 2000 }),
          optInt(args.rest_sec, { min: 0, max: 600 }),
          trimStr(args.notes, 300)
        );
      const after = db.prepare('SELECT * FROM gym_template_exercises WHERE id = ?').get(r.lastInsertRowid);
      const result_row_ids = { template_exercise_ids: [after.id] };
      const response = { op: OPS.add_template_exercise, item: after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.add_template_exercise,
        operationId,
        null,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateTemplateExercise(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.update_template_exercise);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const templateId = Number(args.template_id);
    const itemId = Number(args.item_id);
    const before = db
      .prepare('SELECT * FROM gym_template_exercises WHERE id = ? AND template_id = ? AND user_id = ?')
      .get(itemId, templateId, userId);
    if (!before) return { error: 'template exercise item not found' };
    const doWrite = () => {
      db.prepare(
        `UPDATE gym_template_exercises
            SET target_sets=?, target_reps=?, target_weight=?, rest_sec=?, notes=?, sort_order=?
          WHERE id=? AND user_id=?`
      ).run(
        args.target_sets === undefined ? before.target_sets : optInt(args.target_sets, { min: 0, max: 30 }),
        args.target_reps === undefined ? before.target_reps : optInt(args.target_reps, { min: 0, max: 200 }),
        args.target_weight === undefined
          ? before.target_weight
          : optNum(args.target_weight, { min: 0, max: 2000 }),
        args.rest_sec === undefined ? before.rest_sec : optInt(args.rest_sec, { min: 0, max: 600 }),
        args.notes === undefined ? before.notes : trimStr(args.notes, 300),
        args.sort_order === undefined ? before.sort_order : optInt(args.sort_order, { min: 0, max: 999 }),
        itemId,
        userId
      );
      const after = db.prepare('SELECT * FROM gym_template_exercises WHERE id = ?').get(itemId);
      const result_row_ids = { template_exercise_ids: [itemId] };
      const response = { op: OPS.update_template_exercise, before, after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.update_template_exercise,
        operationId,
        before,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteTemplateExercise(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_template_exercise);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const templateId = Number(args.template_id);
    const itemId = Number(args.item_id);
    const before = db
      .prepare('SELECT * FROM gym_template_exercises WHERE id = ? AND template_id = ? AND user_id = ?')
      .get(itemId, templateId, userId);
    if (!before) return { error: 'template exercise item not found' };
    const doWrite = () => {
      db.prepare('DELETE FROM gym_template_exercises WHERE id = ? AND template_id = ? AND user_id = ?').run(
        itemId,
        templateId,
        userId
      );
      const result_row_ids = { deleted_template_exercise_ids: [itemId] };
      const response = { op: OPS.delete_template_exercise, before, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.delete_template_exercise,
        operationId,
        before,
        null,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function upsertGymSchedule(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.upsert_gym_schedule);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const incoming = Array.isArray(args.days) ? args.days : null;
    if (!incoming) return { error: 'days must be an array' };
    const before = db
      .prepare('SELECT * FROM gym_schedule WHERE user_id = ? ORDER BY weekday')
      .all(userId);
    const doWrite = () => {
      const upsert = db.prepare(`
        INSERT INTO gym_schedule (user_id, weekday, enabled, template_id, duration_min)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, weekday) DO UPDATE SET
          enabled = excluded.enabled,
          template_id = excluded.template_id,
          duration_min = excluded.duration_min
      `);
      const byDay = new Map(incoming.map((d) => [Number(d.weekday), d]));
      for (let w = 1; w <= 7; w += 1) {
        const d = byDay.get(w);
        if (!d) {
          upsert.run(userId, w, 0, null, null);
          continue;
        }
        const enabled = d.enabled === true || d.enabled === 1 || d.enabled === '1' ? 1 : 0;
        let templateId = d.template_id != null ? Number(d.template_id) : null;
        if (enabled && templateId) {
          if (!getGymTemplate(db, userId, templateId)) {
            throw Object.assign(new Error(`template_id ${templateId} not found for weekday ${w}`), {
              code: 'BAD_TEMPLATE',
            });
          }
        } else if (!enabled) {
          templateId = null;
        }
        upsert.run(userId, w, enabled, templateId, optInt(d.duration_min, { min: 0, max: 600 }));
      }
      const after = db
        .prepare('SELECT * FROM gym_schedule WHERE user_id = ? ORDER BY weekday')
        .all(userId);
      const result_row_ids = { weekdays: [1, 2, 3, 4, 5, 6, 7] };
      const response = { op: OPS.upsert_gym_schedule, before, after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.upsert_gym_schedule,
        operationId,
        before,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    try {
      return skipAudit ? doWrite() : db.transaction(doWrite)();
    } catch (e) {
      return { error: e.message };
    }
  });
}

function createGymSession(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.create_gym_session);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const date = isoDateOrNull(args.date) || getLocalDateISO();
    const existing = db
      .prepare(
        `SELECT * FROM gym_sessions WHERE user_id = ? AND date = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
      )
      .get(userId, date);
    if (existing) {
      return {
        op: OPS.create_gym_session,
        session: existing,
        reused_open_session: true,
        result_row_ids: { session_ids: [existing.id] },
        warnings: [],
      };
    }
    const activity = trimStr(args.activity_type, 40) || 'strength';
    const templateId = args.template_id != null ? Number(args.template_id) : null;
    if (templateId && !getGymTemplate(db, userId, templateId)) {
      return { error: `template_id ${templateId} not found` };
    }
    const doWrite = () => {
      const r = db
        .prepare(
          `INSERT INTO gym_sessions (user_id, date, activity_type, template_id, notes, started_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, date, activity, templateId, trimStr(args.notes, 800), nowIso());
      const after = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(r.lastInsertRowid);
      const result_row_ids = { session_ids: [after.id] };
      const response = { op: OPS.create_gym_session, session: after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.create_gym_session,
        operationId,
        null,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function updateGymSession(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.update_gym_session);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.session_id);
    const before = db.prepare('SELECT * FROM gym_sessions WHERE id = ? AND user_id = ?').get(id, userId);
    if (!before) return { error: `session_id ${id} not found` };
    const doWrite = () => {
      let ended_at = before.ended_at;
      let duration_sec = before.duration_sec;
      if (args.finish === true || args.finish === 1) {
        ended_at = nowIso();
        if (before.started_at) {
          const ms = Date.parse(ended_at) - Date.parse(before.started_at);
          if (Number.isFinite(ms) && ms >= 0) duration_sec = Math.round(ms / 1000);
        }
      }
      if (Object.prototype.hasOwnProperty.call(args, 'ended_at')) {
        ended_at = args.ended_at === null ? null : String(args.ended_at);
      }
      if (args.duration_sec !== undefined) duration_sec = optInt(args.duration_sec, { min: 0, max: 86400 });
      db.prepare(
        `UPDATE gym_sessions SET ended_at=?, duration_sec=?, activity_type=?, notes=?
          WHERE id=? AND user_id=?`
      ).run(
        ended_at,
        duration_sec,
        args.activity_type !== undefined ? trimStr(args.activity_type, 40) : before.activity_type,
        args.notes !== undefined ? trimStr(args.notes, 800) : before.notes,
        id,
        userId
      );
      const after = db.prepare('SELECT * FROM gym_sessions WHERE id = ?').get(id);
      const result_row_ids = { session_ids: [id] };
      const response = { op: OPS.update_gym_session, before, after, result_row_ids, warnings: [] };
      return auditWrap(
        db,
        userId,
        OPS.update_gym_session,
        operationId,
        before,
        after,
        result_row_ids,
        response,
        skipAudit
      );
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function addGymSet(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.add_gym_set);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const sessionId = Number(args.session_id);
    const session = db
      .prepare('SELECT * FROM gym_sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return { error: `session_id ${sessionId} not found` };
    if (session.ended_at) return { error: 'Session is finished; reopen it before adding sets' };
    const exerciseId = Number(args.exercise_id);
    if (!getGymExercise(db, userId, exerciseId)) return { error: `exercise_id ${exerciseId} not found` };
    const doWrite = () => {
      const maxIdx = db
        .prepare(
          'SELECT COALESCE(MAX(set_index), 0) AS n FROM gym_sets WHERE session_id = ? AND exercise_id = ?'
        )
        .get(sessionId, exerciseId).n;
      const weight = optNum(args.weight, { min: 0, max: 2000 });
      const is_1rm = args.is_1rm === true || args.is_1rm === 1 ? 1 : 0;
      const r = db
        .prepare(
          `INSERT INTO gym_sets
             (user_id, session_id, exercise_id, set_index, reps, weight, weight_unit, is_warmup, is_1rm, note, logged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          sessionId,
          exerciseId,
          maxIdx + 1,
          optInt(args.reps, { min: 0, max: 500 }),
          weight,
          trimStr(args.weight_unit, 10) || 'lb',
          args.is_warmup === true || args.is_warmup === 1 ? 1 : 0,
          is_1rm,
          trimStr(args.note, 300),
          nowIso()
        );
      if (is_1rm && weight != null) {
        db.prepare(
          `INSERT INTO gym_one_rep_maxes (user_id, exercise_id, tested, estimated, formula, updated_at)
           VALUES (?, ?, ?, NULL, 'logged_set', ?)
           ON CONFLICT(user_id, exercise_id) DO UPDATE SET
             tested = excluded.tested, formula = excluded.formula, updated_at = excluded.updated_at`
        ).run(userId, exerciseId, weight, nowIso());
      }
      const after = db.prepare('SELECT * FROM gym_sets WHERE id = ?').get(r.lastInsertRowid);
      const result_row_ids = { set_ids: [after.id] };
      const response = { op: OPS.add_gym_set, set: after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.add_gym_set, operationId, null, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function deleteGymSet(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.delete_gym_set);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const sessionId = Number(args.session_id);
    const setId = Number(args.set_id);
    const before = db
      .prepare('SELECT * FROM gym_sets WHERE id = ? AND session_id = ? AND user_id = ?')
      .get(setId, sessionId, userId);
    if (!before) return { error: 'set not found' };
    const doWrite = () => {
      db.prepare('DELETE FROM gym_sets WHERE id = ? AND session_id = ? AND user_id = ?').run(
        setId,
        sessionId,
        userId
      );
      const result_row_ids = { deleted_set_ids: [setId] };
      const response = { op: OPS.delete_gym_set, before, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.delete_gym_set, operationId, before, null, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

function upsertOneRm(db, userId, args = {}, { skipAudit = false } = {}) {
  const bad = reject(args, OPS.upsert_one_rm);
  if (bad) return bad;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const exerciseId = Number(args.exercise_id);
    if (!getGymExercise(db, userId, exerciseId)) return { error: `exercise_id ${exerciseId} not found` };
    const before =
      db
        .prepare('SELECT * FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?')
        .get(userId, exerciseId) || null;
    const doWrite = () => {
      db.prepare(
        `INSERT INTO gym_one_rep_maxes (user_id, exercise_id, estimated, tested, formula, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET
           estimated = COALESCE(excluded.estimated, gym_one_rep_maxes.estimated),
           tested = COALESCE(excluded.tested, gym_one_rep_maxes.tested),
           formula = COALESCE(excluded.formula, gym_one_rep_maxes.formula),
           updated_at = excluded.updated_at`
      ).run(
        userId,
        exerciseId,
        args.estimated !== undefined ? optNum(args.estimated, { min: 0, max: 2000 }) : null,
        args.tested !== undefined ? optNum(args.tested, { min: 0, max: 2000 }) : null,
        args.formula !== undefined ? trimStr(args.formula, 40) : null,
        nowIso()
      );
      const after = db
        .prepare('SELECT * FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?')
        .get(userId, exerciseId);
      const result_row_ids = { exercise_ids: [exerciseId] };
      const response = { op: OPS.upsert_one_rm, before, after, result_row_ids, warnings: [] };
      return auditWrap(db, userId, OPS.upsert_one_rm, operationId, before, after, result_row_ids, response, skipAudit);
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

module.exports = {
  OPS,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  reactivateRecipe,
  createSupplement,
  deleteSupplement,
  deleteFoodItem,
  upsertGoals,
  updateProfile,
  upsertBodyWeight,
  deleteBodyWeight,
  createGymExercise,
  createGymTemplate,
  updateGymTemplate,
  deleteGymTemplate,
  addTemplateExercise,
  updateTemplateExercise,
  deleteTemplateExercise,
  upsertGymSchedule,
  createGymSession,
  updateGymSession,
  addGymSet,
  deleteGymSet,
  upsertOneRm,
};
