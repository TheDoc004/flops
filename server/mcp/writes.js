/**
 * MCP direct writes (Phase 3).
 * Writes commit immediately. Bad writes are obvious (source=mcp), audited,
 * and cheap to undo — including revert_mcp_write for non-delete ops.
 */
const { isoDateOrNull, getLocalDateISO } = require('./dates');
const { doseMultiplier } = require('../supplementDose');
const reads = require('./reads');
const {
  findDuplicateMatches,
  DUPLICATE_SIMILARITY_THRESHOLD,
  nameSimilarity,
} = require('./similarity');
const { warningsForFoodMacros, warningsForMealTotals } = require('./warnings');
const {
  normalizeGramsPerServingInput,
  MIN_GRAMS_PER_SERVING,
  isUsableGramsPerServing,
} = require('../gramsPerServing');
const { buildMicrosBlob } = require('../microNutrients');
const { LB_PER_KG, getBodyWeight, upsertBodyWeight } = require('../bodyWeights');
const dietPhases = require('../dietPhases');
const {
  receiptFromRecipeTemplate,
  ingredientMacrosForAmount,
  displayUnitForIngredient,
  listRecipeIngredientLines,
  resolveReceiptForLog,
} = require('../recipeIngredients');
const { isMassUnit, amountInBasisUnit, basisUnitFor } = require('../unitConvert');
const { labelMicrosForRows, storedMicros } = require('../labelMicros');
const { scheduleIngredientMicrosCompletion } = require('../ingredientMicros');

const NUTRITION_SOURCES = new Set(['label', 'database', 'estimate']);
const WEIGHT_BASES = new Set(['raw', 'cooked']);

const OPS = {
  log_meal: 'log_meal',
  add_food_item: 'add_food_item',
  update_food_item: 'update_food_item',
  update_meal_entry: 'update_meal_entry',
  delete_meal_entry: 'delete_meal_entry',
  update_supplement: 'update_supplement',
  create_meal_prep: 'create_meal_prep',
  log_body_weight: 'log_body_weight',
  set_maintenance_calories: 'set_maintenance_calories',
  add_diet_phase: 'add_diet_phase',
  update_diet_phase: 'update_diet_phase',
  delete_diet_phase: 'delete_diet_phase',
  write_batch: 'write_batch',
  revert_mcp_write: 'revert_mcp_write',
};

/** Keys each write op may accept. Unknown keys must refuse — never silent-drop. */
const WRITE_ALLOWED_KEYS = {
  [OPS.log_meal]: new Set([
    'op', 'date', 'name', 'meal_slot', 'time_min', 'weight_basis', 'items', 'operation_id', 'ref',
  ]),
  [OPS.add_food_item]: new Set([
    'op', 'ref', 'name', 'brand_name', 'serving_size_text', 'grams_per_serving',
    'calories_per_100g', 'protein_g_per_100g', 'carbs_g_per_100g', 'fat_g_per_100g', 'fiber_g_per_100g',
    'nutrition_source', 'weight_basis', 'micros_per_100g', 'micros_confidence', 'allow_duplicate', 'operation_id',
    'servings_per_container', 'grams_per_ml',
  ]),
  [OPS.update_food_item]: new Set([
    'op', 'label_ingredient_id', 'name', 'brand_name', 'serving_size_text', 'grams_per_serving', 'grams_per_unit',
    'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'nutrition_source', 'weight_basis',
    'micros', 'micros_per_100g', 'micros_confidence', 'operation_id', 'servings_per_container', 'grams_per_ml',
  ]),
  [OPS.update_meal_entry]: new Set([
    'op', 'log_entry_id', 'date', 'name', 'meal_slot', 'time_min', 'weight_basis', 'items', 'operation_id',
  ]),
  [OPS.delete_meal_entry]: new Set(['op', 'log_entry_id', 'operation_id']),
  [OPS.update_supplement]: new Set([
    'op', 'supplement_id', 'dose_text', 'dose_qty', 'label_serving_qty', 'label_serving_unit',
    'calories', 'protein_g', 'carbs_g', 'fat_g', 'micros', 'taken', 'taken_date', 'operation_id',
  ]),
  [OPS.create_meal_prep]: new Set([
    'op', 'name', 'servings', 'weight_basis', 'items', 'operation_id',
  ]),
  [OPS.log_body_weight]: new Set(['op', 'weight', 'unit', 'date', 'operation_id']),
  [OPS.set_maintenance_calories]: new Set(['op', 'maintenance_calories', 'operation_id']),
  [OPS.add_diet_phase]: new Set(['op', 'kind', 'label', 'start_date', 'end_date', 'notes', 'operation_id']),
  [OPS.update_diet_phase]: new Set([
    'op', 'diet_phase_id', 'kind', 'label', 'start_date', 'end_date', 'notes', 'operation_id',
  ]),
  [OPS.delete_diet_phase]: new Set(['op', 'diet_phase_id', 'operation_id']),
  [OPS.write_batch]: new Set(['operations', 'operation_id']),
  [OPS.revert_mcp_write]: new Set(['audit_id', 'operation_id']),
};

function rejectUnknownArgs(args, opName) {
  const allowed = WRITE_ALLOWED_KEYS[opName];
  if (!allowed) return null;
  const unknown = Object.keys(args || {}).filter(k => !allowed.has(k));
  if (!unknown.length) return null;
  return {
    error:
      `${opName} does not accept parameter(s): ${unknown.join(', ')}. ` +
      `Unknown fields are refused (not ignored) so a write cannot look successful while dropping data.`,
    code: 'UNKNOWN_PARAM',
    unknown,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function round(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

function normalizeMicrosConfidence(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'high' || s === 'medium' || s === 'low') return { confidence: s };
  return {
    error:
      'micros_confidence is required when writing micros and must be high|medium|low. ' +
      'Use high for label-exact panels, medium for USDA/database tables, low for guesses.',
  };
}

function microsJsonFromPerServing(raw, { confidence = 'medium', notes } = {}) {
  if (raw === null) return { micros_json: null };
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'micros must be an object of nutrient → amount (per label serving), or null to clear' };
  }
  const blob = buildMicrosBlob(raw, {
    confidence,
    notes: notes || 'Updated via MCP (per label serving)',
  });
  if (!blob) {
    return {
      error:
        'micros contained no recognized nutrient keys with positive values ' +
        '(keys must match the FLOPS micro set, e.g. sodium_mg, vitamin_d_mcg)',
    };
  }
  return { micros_json: JSON.stringify(blob) };
}

function microsJsonFromPer100g(raw, gramsPerServing, { confidence = 'medium', notes } = {}) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'micros_per_100g must be an object of nutrient → amount' };
  }
  if (!isUsableGramsPerServing(gramsPerServing)) {
    return {
      error:
        `micros_per_100g requires grams_per_serving ≥ ${MIN_GRAMS_PER_SERVING} on the food to scale to per-serving storage. ` +
        `Set grams_per_serving first, or pass micros (per label serving) instead.`,
    };
  }
  const scale = Number(gramsPerServing) / 100;
  const scaled = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n)) scaled[k] = round(n * scale, 3);
  }
  const blob = buildMicrosBlob(scaled, {
    confidence,
    notes: notes || 'Updated via MCP (per_100g scaled to serving)',
  });
  if (!blob) {
    return {
      error:
        'micros_per_100g contained no recognized nutrient keys with positive values ' +
        '(keys must match the FLOPS micro set, e.g. sodium_mg, vitamin_d_mcg)',
    };
  }
  return { micros_json: JSON.stringify(blob) };
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
  const all = db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, created_via, nutrition_source
         FROM label_ingredients
        WHERE user_id = ?
        ORDER BY use_count DESC, id DESC
        LIMIT 500`
    )
    .all(userId);
  return all
    .map(row => ({ ...row, similarity: nameSimilarity(name, row.name) }))
    .filter(r => r.similarity >= 0.45 || (q.length >= 3 && normalizeLooseIncludes(name, r.name)))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function normalizeLooseIncludes(a, b) {
  const s = String(a || '').toLowerCase();
  const t = String(b || '').toLowerCase();
  return s.includes(t) || t.includes(s);
}

function loadLibraryForDupCheck(db, userId) {
  return db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, created_via, nutrition_source
         FROM label_ingredients WHERE user_id = ? LIMIT 500`
    )
    .all(userId);
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

/** Grams an amount comes to, or null when the ingredient has no gram weight. */
function gramsForAmount(row, amount, unit) {
  const inBasis = amountInBasisUnit(row, amount, unit);
  if (inBasis == null) return null;
  const gpu = basisUnitFor(row)?.gramsPerUnit;
  if (row.tracking_type !== 'unit') return inBasis;
  return gpu ? inBasis * gpu : null;
}

/**
 * Library rows that carry micros but contributed none to the logged rows —
 * the scaler couldn't convert the amount. Never let that be a silent zero.
 */
function droppedMicrosWarnings(db, userId, rows) {
  const list = (rows || []).filter(r => Number(r?.label_ingredient_id) > 0);
  if (!list.length) return [];
  const { uncovered } = labelMicrosForRows(db, list, userId);
  const get = db.prepare(
    'SELECT name, micros_json, tracking_type, unit_name, grams_per_unit, grams_per_ml FROM label_ingredients WHERE id = ? AND user_id = ?'
  );
  const out = [];
  for (const r of uncovered) {
    const ing = get.get(Number(r.label_ingredient_id), userId);
    if (!ing || !storedMicros(ing.micros_json)) continue;
    out.push(
      `Micros for "${ing.name}" were NOT counted: ${r.amount} ${r.unit || ''} can't be converted to its ` +
      `serving${ing.tracking_type === 'unit' && !(Number(ing.grams_per_unit) > 0)
        ? ` (counted in ${ing.unit_name || 'units'}, no grams_per_unit)` : ''}.`
    );
  }
  return out;
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

// Limited-use (meal prep) accounting — mirrors routes/log.js so a container
// logged through MCP counts down exactly like one logged in the app. A use is
// charged to the log entry whose recipe_id is the limited recipe; soft-deleting
// that entry hands the uses back (capped at max_uses), restoring it re-charges.
const usesOf = servings => Math.max(1, Math.ceil(Number(servings) || 1));

function isLimitedRecipe(recipe) {
  return recipe && recipe.recipe_kind === 'limited' && recipe.remaining_uses != null;
}

function consumeLimitedUses(db, userId, recipeId, servings) {
  const need = usesOf(servings);
  const r = db
    .prepare(
      `UPDATE recipes
          SET remaining_uses = remaining_uses - ?,
              is_archived = CASE WHEN remaining_uses - ? <= 0 THEN 1 ELSE is_archived END
        WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL
          AND remaining_uses >= ?`
    )
    .run(need, need, recipeId, userId, need);
  if (r.changes > 0) return;
  const row = db
    .prepare('SELECT recipe_kind, remaining_uses FROM recipes WHERE id = ? AND user_id = ?')
    .get(recipeId, userId);
  if (isLimitedRecipe(row)) {
    throw Object.assign(
      new Error(`Meal prep recipe #${recipeId} has ${row.remaining_uses} use(s) left; ${need} needed.`),
      { code: 'LIMIT_USES' }
    );
  }
}

function restoreLimitedUses(db, userId, recipeId, servings) {
  const back = usesOf(servings);
  // Un-archive only when exhausted (remaining 0) so a manually archived
  // template stays archived. SET expressions read pre-update values.
  db.prepare(
    `UPDATE recipes
        SET remaining_uses = CASE
              WHEN max_uses IS NOT NULL THEN MIN(max_uses, remaining_uses + ?)
              ELSE remaining_uses + ?
            END,
            is_archived = CASE WHEN remaining_uses <= 0 THEN 0 ELSE is_archived END
      WHERE id = ? AND user_id = ? AND recipe_kind = 'limited' AND remaining_uses IS NOT NULL`
  ).run(back, back, recipeId, userId);
}

function entryUsage(db, userId, entryId) {
  return db
    .prepare(`SELECT recipe_id, servings, COALESCE(is_deleted, 0) AS is_deleted FROM log_entries WHERE id = ? AND user_id = ?`)
    .get(entryId, userId);
}

/** Soft-delete a log entry and hand its limited-recipe uses back. */
function softDeleteEntry(db, userId, entryId) {
  const e = entryUsage(db, userId, entryId);
  if (!e || e.is_deleted) return;
  db.prepare(`UPDATE log_entries SET is_deleted = 1 WHERE id = ? AND user_id = ?`).run(entryId, userId);
  if (e.recipe_id != null) restoreLimitedUses(db, userId, e.recipe_id, e.servings);
}

/** Restore a soft-deleted log entry and re-charge its limited-recipe uses. */
function undeleteEntry(db, userId, entryId) {
  const e = entryUsage(db, userId, entryId);
  if (!e || !e.is_deleted) return;
  if (e.recipe_id != null) consumeLimitedUses(db, userId, e.recipe_id, e.servings);
  db.prepare(`UPDATE log_entries SET is_deleted = 0 WHERE id = ? AND user_id = ?`).run(entryId, userId);
}

/** Run a write transaction, turning a LIMIT_USES throw into a tool error. */
function runWriteTx(db, fn) {
  try {
    return db.transaction(fn)();
  } catch (e) {
    if (e.code === 'LIMIT_USES') return { error: e.message, code: 'LIMIT_USES' };
    throw e;
  }
}

/**
 * A recipe's lines with per-serving overrides applied ("Wombo Combo, but 180 g
 * yogurt and no honey"), resolved through the same receipt code the app uses
 * when you edit amounts at log time — so macros and micros come from the
 * library at the logged amounts, not from the recipe's saved totals.
 * adjust: [{label_ingredient_id, quantity_g | quantity (+unit) | remove: true}]
 */
function adjustedRecipeReceipt(db, userId, recipeId, adjust, index) {
  if (!Array.isArray(adjust) || !adjust.length) {
    return { error: `items[${index}].adjust must be a non-empty array` };
  }
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(recipeId, userId);
  const lines = listRecipeIngredientLines(recipe).map(l => ({
    name: l.name,
    amount: Number(l.amount),
    unit: l.unit,
    label_ingredient_id: l.label_ingredient_id != null ? Number(l.label_ingredient_id) : null,
  }));
  if (!lines.length) {
    return { error: `items[${index}]: recipe #${recipeId} has no library ingredient lines to adjust` };
  }
  const adjusted = [];
  for (const [j, a] of adjust.entries()) {
    const where = `items[${index}].adjust[${j}]`;
    const lid = Number(a?.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) return { error: `${where}.label_ingredient_id is required` };
    const line = lines.find(l => l.label_ingredient_id === lid);
    if (!line) {
      return {
        error:
          `${where}: label_ingredient_id ${lid} is not in recipe #${recipeId} (get_recipe lists its lines). ` +
          'To add a food, pass it as its own item next to the recipe.',
        code: 'NOT_IN_RECIPE',
      };
    }
    if (a.remove === true) {
      line.removed = true;
      adjusted.push({ label_ingredient_id: lid, name: line.name, removed: true });
      continue;
    }
    const hasGrams = a.quantity_g != null;
    const hasQty = a.quantity != null;
    if (hasGrams === hasQty) return { error: `${where}: give quantity_g, quantity (+ unit), or remove: true` };
    const amount = Number(hasGrams ? a.quantity_g : a.quantity);
    if (!Number.isFinite(amount) || amount <= 0) return { error: `${where}: amount must be a positive number` };
    adjusted.push({ label_ingredient_id: lid, name: line.name, from: `${line.amount} ${line.unit}`, to: null });
    line.amount = amount;
    line.unit = hasGrams ? 'g' : (a.unit != null && a.unit !== '' ? String(a.unit) : line.unit);
    adjusted[adjusted.length - 1].to = `${line.amount} ${line.unit}`;
  }
  try {
    const receipt = resolveReceiptForLog(db, lines.filter(l => !l.removed), userId);
    return { ...receipt, adjusted };
  } catch (e) {
    return {
      error:
        `items[${index}].adjust: ${e.ingredientName ? `"${e.ingredientName}" ` : ''}` +
        `can't be measured that way [${e.code || e.message}]`,
      code: e.code === 'EMPTY_RECEIPT' ? 'EMPTY_RECEIPT' : 'UNIT_NOT_CONVERTIBLE',
    };
  }
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
  if (working?.adjust != null && working?.recipe_id == null) {
    return { error: `items[${index}].adjust only applies to recipe items (recipe_id)` };
  }

  if (working?.label_ingredient_id != null) {
    const id = Number(working.label_ingredient_id);
    const row = db
      .prepare(
        `SELECT id, name, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
                micros_json, weight_basis, tracking_type, unit_name, serving_quantity, grams_per_unit, grams_per_ml
           FROM label_ingredients WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return { error: `items[${index}]: label_ingredient_id ${id} not found` };
    // An amount is grams (quantity_g) or a count/measure in a unit (quantity + unit).
    const hasGrams = working?.quantity_g != null;
    const hasQty = working?.quantity != null;
    if (hasGrams === hasQty) {
      return { error: `items[${index}]: give quantity_g, or quantity (+ optional unit) — exactly one` };
    }
    const amount = hasGrams ? quantity_g : Number(working.quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: `items[${index}].${hasGrams ? 'quantity_g' : 'quantity'} must be a positive number` };
    }
    const unitIn = hasGrams ? 'g' : (working.unit != null && working.unit !== '' ? String(working.unit) : null);
    const storedBasis = normalizeWeightBasis(row.weight_basis);
    if (storedBasis && storedBasis !== weight_basis) {
      return {
        error:
          `items[${index}]: weight_basis "${weight_basis}" conflicts with library ingredient ` +
          `#${id} ("${row.name}") stored as "${storedBasis}". ` +
          `Use the matching weight_basis (item overrides meal), or update_food_item first. ` +
          `No raw↔cooked conversion is applied.`,
      };
    }
    // Same scaler as app logging (unitConvert via ingredientMacrosForAmount),
    // so macros and the micros derived later from this row always agree.
    const unit = displayUnitForIngredient(row, unitIn ?? undefined);
    const raw = ingredientMacrosForAmount(row, amount, unitIn ?? unit);
    if (!raw) {
      const basis = basisUnitFor(row);
      const countWithoutGrams = row.tracking_type === 'unit' && isMassUnit(unitIn || '') && !basis?.gramsPerUnit;
      return {
        error: countWithoutGrams
          ? `items[${index}]: "${row.name}" is counted in ${basis.unit} and has no grams_per_unit, so ` +
            `${amount} ${unitIn} can't be converted. Log it by count (quantity + unit "${basis.unit}"), ` +
            `or set grams_per_unit with update_food_item.`
          : `items[${index}]: "${row.name}" can't be measured in "${unitIn || unit}" ` +
            `(its serving is ${row.tracking_type === 'unit' ? basis?.unit : 'grams'}; set grams_per_serving / grams_per_unit if missing, ` +
            `or grams_per_ml with update_food_item to convert between weight and volume).`,
        code: 'UNIT_NOT_CONVERTIBLE',
      };
    }
    const macros = {
      calories: round(raw.calories, 1),
      protein_g: round(raw.protein_g, 2),
      carbs_g: round(raw.carbs_g, 2),
      fat_g: round(raw.fat_g, 2),
      fiber_g: row.fiber_g == null ? null : round(raw.fiber_g, 2),
    };
    const storedUnit = hasGrams ? 'g' : unit;
    return {
      item: {
        kind: 'label_ingredient',
        label_ingredient_id: row.id,
        name: row.name,
        amount,
        unit: storedUnit,
        quantity_g: hasGrams ? quantity_g : gramsForAmount(row, amount, storedUnit),
        weight_basis,
        resolved_weight_basis: weight_basis,
        library_weight_basis: storedBasis || null,
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
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_deleted,
                recipe_kind, remaining_uses, is_archived
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!recipe || recipe.is_deleted) {
      return { error: `items[${index}]: recipe_id ${id} not found` };
    }
    const s = Number.isFinite(servings) && servings > 0 ? servings : null;
    if (s == null) return { error: `items[${index}]: recipe items need servings` };
    let receipt = null;
    if (working.adjust != null) {
      receipt = adjustedRecipeReceipt(db, userId, id, working.adjust, index);
      if (receipt.error) return receipt;
    }
    const limited = isLimitedRecipe(recipe);
    if (limited && (recipe.is_archived || Number(recipe.remaining_uses) < usesOf(s))) {
      return {
        error:
          `items[${index}]: meal prep recipe #${id} ("${recipe.name}") has ${recipe.remaining_uses} use(s) left; ` +
          `${usesOf(s)} needed.`,
        code: 'LIMIT_USES',
      };
    }
    return {
      item: {
        kind: 'recipe',
        recipe_id: recipe.id,
        name: recipe.name,
        servings: s,
        limited,
        quantity_g: Number.isFinite(quantity_g) ? quantity_g : null,
        weight_basis,
        resolved_weight_basis: weight_basis,
        nutrition_source,
        macros: {
          calories: round((Number(recipe.calories) || 0) * s, 1),
          protein_g: round((Number(recipe.protein_g) || 0) * s, 2),
          carbs_g: round((Number(recipe.carbs_g) || 0) * s, 2),
          fat_g: round((Number(recipe.fat_g) || 0) * s, 2),
          fiber_g: recipe.fiber_g == null ? null : round((Number(recipe.fiber_g) || 0) * s, 2),
        },
        serving_size: recipe.serving_size,
        ...(receipt
          ? {
              receipt_rows: receipt.rows,
              adjusted: receipt.adjusted,
              macros: {
                calories: round(receipt.perServing.calories * s, 1),
                protein_g: round(receipt.perServing.protein_g * s, 2),
                carbs_g: round(receipt.perServing.carbs_g * s, 2),
                fat_g: round(receipt.perServing.fat_g * s, 2),
                fiber_g: receipt.perServing.fiber_g == null ? null : round(receipt.perServing.fiber_g * s, 2),
              },
            }
          : {}),
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
  let micros_per_100g = null;
  if (Object.prototype.hasOwnProperty.call(working, 'micros_per_100g')) {
    // Validate now (100g serving for inline new foods) so a bad blob refuses the meal write.
    const m = microsJsonFromPer100g(working.micros_per_100g, 100, {
      confidence: 'medium',
      notes: 'Created via MCP log_meal (per_100g)',
    });
    if (m.error) return { error: `items[${index}]: ${m.error}` };
    micros_per_100g = working.micros_per_100g;
  }
  return {
    item: {
      kind: 'new_food',
      name,
      amount: quantity_g,
      unit: 'g',
      quantity_g,
      weight_basis,
      resolved_weight_basis: weight_basis,
      nutrition_source,
      per_100g: per100,
      macros: scalePer100g(per100, quantity_g),
      similar_library_items: similar,
      micros_per_100g,
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
  // New meal foods use a 100g serving, so per-100g micros equal per-serving storage.
  let microsJson = null;
  if (item.micros_per_100g != null) {
    const m = microsJsonFromPer100g(item.micros_per_100g, 100, {
      confidence: 'medium',
      notes: 'Created via MCP log_meal (per_100g)',
    });
    if (m.error) throw Object.assign(new Error(m.error), { code: 'BAD_MICROS' });
    microsJson = m.micros_json;
  }
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
      per100.fiber_g, microsJson, item.weight_basis, item.nutrition_source
    );
  scheduleIngredientMicrosCompletion(db, userId, r.lastInsertRowid);
  return r.lastInsertRowid;
}

function fetchLogEntryById(db, userId, id, { includeDeleted = false } = {}) {
  const raw = db
    .prepare(
      `SELECT le.id, le.recipe_id, le.date, le.time_min, le.servings, le.notes,
              le.ingredients_json, COALESCE(le.source, 'app') AS source,
              le.weight_basis, le.nutrition_source,
              COALESCE(le.is_deleted, 0) AS is_deleted,
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
        WHERE le.id = ? AND le.user_id = ?
          AND (? = 1 OR COALESCE(le.is_deleted, 0) = 0)`
    )
    .get(id, userId, includeDeleted ? 1 : 0);
  if (!raw) return null;
  if (!raw.is_deleted) {
    const day = reads.getDay(db, userId, raw.date);
    const shaped = (day.meals || []).find(m => Number(m.id) === Number(id));
    if (shaped) return shaped;
  }
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
    is_deleted: Number(raw.is_deleted) === 1,
    is_quick_food: raw.recipe_is_quick_food,
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

/**
 * Per-serving ingredients snapshot for a recipe log — the same rows POST
 * /api/log stores (via receiptFromRecipeTemplate), so entry micros resolve
 * live from the library exactly as for app logs. Macros on the entry still
 * come from the recipe row. A recipe with no library lines, or one whose
 * lines can't be scaled, keeps a null snapshot rather than refusing the log.
 */
function recipeIngredientsSnapshotJson(db, userId, recipe, warnings = null) {
  try {
    const receipt = receiptFromRecipeTemplate(db, recipe, userId);
    return receipt?.rows?.length ? JSON.stringify(receipt.rows) : null;
  } catch (e) {
    if (warnings) {
      const who = e.ingredientName ? ` ("${e.ingredientName}"${e.unit ? ` in ${e.unit}` : ''})` : '';
      warnings.push(
        `Micros for recipe "${recipe.name}" were NOT counted: a recipe line can't be scaled${who} ` +
        `[${e.code || e.message}]. Macros come from the recipe row.`
      );
    }
    return null;
  }
}

/**
 * One recipe changed at log time — lines adjusted ("Wombo Combo with 73 g
 * bread") and/or add-on foods ("prep container + 21 g honey") — stored as ONE
 * entry against that recipe. A meal prep's use counts down and is handed back
 * on delete like a plain container. log_entries hold per-serving values that
 * reads multiply by servings, so add-ons are divided by servings before they
 * sit next to the recipe's own (already per-serving) rows.
 */
function insertRecipeWithChanges(db, userId, built, prep, addOnRows, nutrition_source, result) {
  const { date, meal_slot, time_min, weight_basis, totals, warnings } = built;
  const recipe = db
    .prepare(
      `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_quick_food,
              ingredients, meal_builder_meta
         FROM recipes WHERE id = ? AND user_id = ?`
    )
    .get(prep.recipe_id, userId);
  if (!recipe) throw Object.assign(new Error('Recipe missing'), { code: 'RECIPE_GONE' });
  const servings = Number(prep.servings) || 1;
  const per = v => (v == null ? null : round(Number(v) / servings, 2));

  const snapshot = prep.receipt_rows
    ? JSON.stringify(prep.receipt_rows)
    : recipeIngredientsSnapshotJson(db, userId, recipe, warnings);
  let ingredientsJson = null;
  if (snapshot) {
    const addOnsPerServing = addOnRows.map(r => ({
      ...r,
      amount: per(r.amount),
      calories: per(r.calories), protein_g: per(r.protein_g), carbs_g: per(r.carbs_g),
      fat_g: per(r.fat_g), fiber_g: per(r.fiber_g),
      add_on: true,
    }));
    ingredientsJson = JSON.stringify([...JSON.parse(snapshot), ...addOnsPerServing]);
  } else if (warnings) {
    warnings.push(`Micros for "${recipe.name}" + add-ons were NOT counted: the recipe could not be snapshotted.`);
  }

  const name = built.explicitName || !addOnRows.length
    ? (built.explicitName ? built.name : recipe.name)
    : `${recipe.name} + ${addOnRows.map(r => r.name).join(', ')}`;
  const ins = db
    .prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g,
         recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, slot_selections_json,
         ingredients_json, source, weight_basis, nutrition_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'mcp', ?, ?)`
    )
    .run(
      userId, recipe.id, date, time_min, servings, meal_slot ? `slot:${meal_slot}` : null,
      name, recipe.serving_size,
      round(totals.calories / servings, 1), per(totals.protein_g), per(totals.carbs_g),
      per(totals.fat_g), per(totals.fiber_g),
      ingredientsJson, weight_basis, nutrition_source
    );
  if (prep.limited) consumeLimitedUses(db, userId, recipe.id, servings);
  result.log_entry_ids.push(ins.lastInsertRowid);
  return result;
}

function insertMealFromResolved(db, userId, built) {
  const { date, name, meal_slot, time_min, weight_basis, resolved, totals, warnings = null } = built;
  const result = { log_entry_ids: [], label_ingredient_ids: [] };
  const ingredientRows = [];

  for (const item of resolved) {
    if (item.kind === 'new_food') {
      const lid = createLabelFromNewFood(db, userId, item);
      result.label_ingredient_ids.push(lid);
      ingredientRows.push({
        name: item.name, amount: item.amount, unit: item.unit, label_ingredient_id: lid,
        calories: item.macros.calories, protein_g: item.macros.protein_g, carbs_g: item.macros.carbs_g,
        fat_g: item.macros.fat_g, fiber_g: item.macros.fiber_g, weight_basis: item.weight_basis,
        nutrition_source: item.nutrition_source,
      });
    } else if (item.kind === 'label_ingredient') {
      ingredientRows.push({
        name: item.name, amount: item.amount, unit: item.unit, label_ingredient_id: item.label_ingredient_id,
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

  // One recipe changed at log time (adjusted lines and/or add-on foods) is
  // stored against that recipe, not flattened into a quick-food meal.
  const recipeItems = resolved.filter(i => i.kind === 'recipe');
  if (recipeItems.length === 1 && (recipeItems[0].receipt_rows || resolved.length > 1)) {
    const nutritionSource = resolved.every(i => i.nutrition_source === 'label')
      ? 'label'
      : resolved.some(i => i.nutrition_source === 'estimate') ? 'estimate' : 'database';
    const addOnRows = ingredientRows.filter(r => r.recipe_id == null);
    return insertRecipeWithChanges(db, userId, built, recipeItems[0], addOnRows, nutritionSource, result);
  }

  const onlyRecipe = resolved.length === 1 && resolved[0].kind === 'recipe' ? resolved[0] : null;
  if (onlyRecipe) {
    const recipe = db
      .prepare(
        `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, is_quick_food,
                ingredients, meal_builder_meta
           FROM recipes WHERE id = ? AND user_id = ?`
      )
      .get(onlyRecipe.recipe_id, userId);
    if (!recipe) throw Object.assign(new Error('Recipe missing'), { code: 'RECIPE_GONE' });
    const ingredientsJson = recipeIngredientsSnapshotJson(db, userId, recipe, warnings);
    const ins = db
      .prepare(
        `INSERT INTO log_entries (
           user_id, recipe_id, date, time_min, servings, notes,
           recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g,
           recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, slot_selections_json,
           ingredients_json, source, weight_basis, nutrition_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'mcp', ?, ?)`
      )
      .run(
        userId, recipe.id, date, time_min, onlyRecipe.servings,
        meal_slot ? `slot:${meal_slot}` : null, recipe.name, recipe.serving_size,
        recipe.calories, recipe.protein_g, recipe.carbs_g, recipe.fat_g, recipe.fiber_g,
        recipe.is_quick_food ? 1 : 0, ingredientsJson, weight_basis, onlyRecipe.nutrition_source
      );
    if (onlyRecipe.limited) consumeLimitedUses(db, userId, recipe.id, onlyRecipe.servings);
    result.log_entry_ids.push(ins.lastInsertRowid);
    return result;
  }

  const nutrition_source = resolved.every(i => i.nutrition_source === 'label')
    ? 'label'
    : resolved.every(i => i.nutrition_source === 'database')
      ? 'database'
      : resolved.some(i => i.nutrition_source === 'estimate')
        ? 'estimate'
        : 'database';

  const recipeId = ensureQuickFoodRecipe(db, userId, name, totals);

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
    if (r.error) return r.code ? { error: r.error, code: r.code } : { error: r.error };
    resolved.push(r.item);
    warnings.push(...(r.warnings || []));
  }
  const limitedItems = resolved.filter(it => it.limited);
  if (limitedItems.length && (limitedItems.length > 1 || resolved.some(it => it.kind === 'recipe' && !it.limited))) {
    // A container plus add-on foods is stored against the prep recipe (so its
    // use is handed back on delete). Two preps, or a prep plus another recipe,
    // have no single recipe to charge.
    return {
      error:
        'A meal prep (limited-use) recipe can be logged with add-on foods (label ingredients or new foods), ' +
        'but not with another recipe or a second meal prep. Log those as separate meals.',
      code: 'MEAL_PREP_MIXED',
    };
  }
  const totals = sumItemMacros(resolved);
  const meal_slot = args.meal_slot ? String(args.meal_slot).trim() : null;
  const name = String(args.name || '').trim() || (meal_slot ? `${meal_slot} meal` : 'MCP meal');
  const time_min = args.time_min == null || args.time_min === '' ? null : Number(args.time_min);
  if (time_min != null && (!Number.isFinite(time_min) || time_min < 0 || time_min > 1439)) {
    return { error: 'time_min must be minutes from midnight (0–1439)' };
  }
  const explicitName = !!String(args.name || '').trim();
  return { date, name, explicitName, meal_slot, time_min, weight_basis, resolved, totals, warnings };
}

function collectMealWarnings(built) {
  const base = [...(built.warnings || [])];
  base.push(...warningsForMealTotals(built.totals, built.resolved));
  // de-dupe
  return [...new Set(base)];
}

function daySlice(day) {
  return {
    date: day.date,
    meal_totals: day.meal_totals,
    combined_totals: day.combined_totals,
    vs_goals: day.vs_goals,
    // Compact on purpose: the written entry is already in the response, and
    // repeating every meal's ingredients + micros doubled the payload.
    // get_day returns the full meals.
    meals: (day.meals || []).map(m => ({
      id: m.id,
      name: m.recipe_name,
      time_min: m.time_min ?? null,
      servings: m.servings,
      logged: m.logged,
    })),
  };
}

function logMeal(db, userId, args = {}, { refMap = null, skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.log_meal);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const built = buildMealPayload(db, userId, args, refMap);
    if (built.error) return built;
    const mealWarnings = collectMealWarnings(built);

    const doWrite = () => {
      const ids = insertMealFromResolved(db, userId, { ...built, warnings: mealWarnings });
      const entry = fetchLogEntryById(db, userId, ids.log_entry_ids[0]);
      mealWarnings.push(...droppedMicrosWarnings(db, userId, entry?.ingredients));
      const day = reads.getDay(db, userId, built.date);
      const response = {
        op: OPS.log_meal,
        entry,
        day: daySlice(day),
        result_row_ids: ids,
        warnings: mealWarnings,
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.log_meal, operationId, before: null, after: entry,
          result_row_ids: ids, warnings: mealWarnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : runWriteTx(db, doWrite);
  });
}

function getFoodRow(db, userId, id) {
  return db
    .prepare(
      `SELECT id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, fiber_g, micros_json,
              created_via, weight_basis, nutrition_source, source_type, tracking_type,
              unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml
         FROM label_ingredients WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
}

/**
 * grams_per_ml arg -> { value } (null clears) or { error }. Real foods sit
 * between oils (~0.9) and syrups (~1.4); the wide bounds only catch a value
 * entered in the wrong unit (ml per gram, or per 100 ml).
 */
function normalizeGramsPerMl(raw) {
  if (raw == null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.1 || n > 5) {
    return { error: 'grams_per_ml must be a density between 0.1 and 5 g/ml (e.g. 1.2 for soy sauce), or null to clear' };
  }
  return { value: n };
}

/** servings_per_container arg -> { value } (null clears) or { error }. */
function normalizeServingsPerContainer(raw) {
  if (raw == null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: 'servings_per_container must be a positive number (or null to clear)' };
  return { value: n };
}

function addFoodItem(db, userId, args = {}, { skipAudit = false, refMap = null } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.add_food_item);
  if (badKeys) return badKeys;
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
    let grams_per_serving;
    if (args.grams_per_serving != null && args.grams_per_serving !== '') {
      const gps = normalizeGramsPerServingInput(args.grams_per_serving);
      if (gps.error) return { error: gps.error };
      grams_per_serving = gps.value;
    } else {
      // Creating from per-100g macros: default to a 100g serving (always valid).
      grams_per_serving = 100;
    }
    if (grams_per_serving == null) {
      return {
        error:
          `grams_per_serving is required when creating from per-100g macros ` +
          `(minimum ${MIN_GRAMS_PER_SERVING}g), or pass a real label serving weight.`,
      };
    }
    const brand_name = args.brand_name ? String(args.brand_name).trim() : null;
    const spc = normalizeServingsPerContainer(args.servings_per_container);
    if (spc.error) return { error: spc.error };
    const density = normalizeGramsPerMl(args.grams_per_ml);
    if (density.error) return { error: density.error };
    const library = loadLibraryForDupCheck(db, userId);
    const duplicates = findDuplicateMatches(library, name, {
      threshold: DUPLICATE_SIMILARITY_THRESHOLD,
    });
    if (duplicates.length && !args.allow_duplicate) {
      return {
        error:
          `Refusing to create "${name}" — ${duplicates.length} similar library item(s) ` +
          `(similarity ≥ ${DUPLICATE_SIMILARITY_THRESHOLD}). Pass allow_duplicate: true to force, ` +
          `or reuse an existing label_ingredient_id.`,
        code: 'DUPLICATE_FOOD',
        matching: duplicates.slice(0, 5),
      };
    }
    const similar = searchSimilarIngredients(db, userId, name);
    const warnings = [
      ...warningsForFoodMacros({
        name,
        calories: per100.calories,
        protein_g: per100.protein_g,
        carbs_g: per100.carbs_g,
        fat_g: per100.fat_g,
        fiber_g: per100.fiber_g,
        micros: args.micros_per_100g,
        nutrition_source,
        basis: 'per_100g',
      }),
    ];
    if (duplicates.length && args.allow_duplicate) {
      warnings.push(`Created despite ${duplicates.length} similar name(s) (allow_duplicate=true).`);
    } else if (similar.length) {
      warnings.push(`Found ${similar.length} somewhat similar library item(s) for "${name}".`);
    }
    const scale = grams_per_serving / 100;
    const servingMacros = {
      calories: round(per100.calories * scale, 1),
      protein_g: round(per100.protein_g * scale, 2),
      carbs_g: round(per100.carbs_g * scale, 2),
      fat_g: round(per100.fat_g * scale, 2),
      fiber_g: per100.fiber_g == null ? null : round(per100.fiber_g * scale, 2),
    };
    let microsJson = null;
    if (Object.prototype.hasOwnProperty.call(args, 'micros_per_100g')) {
      const conf = normalizeMicrosConfidence(args.micros_confidence);
      if (conf.error) return { error: conf.error };
      const m = microsJsonFromPer100g(args.micros_per_100g, grams_per_serving, {
        confidence: conf.confidence,
        notes: 'Created via MCP add_food_item (per_100g scaled to serving)',
      });
      if (m.error) return { error: m.error };
      microsJson = m.micros_json;
    } else if (Object.prototype.hasOwnProperty.call(args, 'micros_confidence')) {
      return {
        error: 'micros_confidence only applies when writing micros_per_100g (or micros on update_food_item)',
      };
    }

    const doWrite = () => {
      const r = db
        .prepare(
          `INSERT INTO label_ingredients (
             user_id, name, base_label, brand_name, serving_size_text, grams_per_serving,
             calories, protein_g, carbs_g, fat_g, fiber_g, photo_data_uri, source_type,
             use_count, last_used_at, tracking_type, unit_name, serving_quantity, grams_per_unit,
             barcode, micros_json, created_via, weight_basis, nutrition_source, servings_per_container,
             grams_per_ml
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'manual',
                     0, NULL, 'weight', NULL, NULL, NULL, NULL, ?, 'mcp', ?, ?, ?, ?)`
        )
        .run(
          userId, name, brand_name, serving_size_text, grams_per_serving,
          servingMacros.calories, servingMacros.protein_g, servingMacros.carbs_g,
          servingMacros.fat_g, servingMacros.fiber_g, microsJson, weight_basis, nutrition_source, spc.value,
          density.value
        );
      const id = r.lastInsertRowid;
      scheduleIngredientMicrosCompletion(db, userId, id);
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
  const badKeys = rejectUnknownArgs(args, OPS.update_food_item);
  if (badKeys) return badKeys;
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
    const isUnit = before.tracking_type === 'unit';
    if (Object.prototype.hasOwnProperty.call(args, 'grams_per_serving')) {
      // Clearing is always safe: on a unit row grams_per_serving is a stray
      // left over from before grams_per_unit, and nothing scales by it.
      if (isUnit && args.grams_per_serving === null) {
        patch.grams_per_serving = null;
      } else if (isUnit) {
        return {
          error:
            `"${before.name}" is counted in ${before.unit_name || 'units'}; its gram weight is grams_per_unit ` +
            `(grams in one ${before.unit_name || 'unit'}), not grams_per_serving.`,
          code: 'UNIT_TRACKED',
        };
      } else {
        const gps = normalizeGramsPerServingInput(args.grams_per_serving);
        if (gps.error) return { error: gps.error };
        patch.grams_per_serving = gps.value;
      }
    }
    if (Object.prototype.hasOwnProperty.call(args, 'grams_per_unit')) {
      if (!isUnit) {
        return {
          error: `"${before.name}" is weight-tracked; set grams_per_serving instead of grams_per_unit.`,
          code: 'WEIGHT_TRACKED',
        };
      }
      const gpu = args.grams_per_unit == null || args.grams_per_unit === '' ? null : Number(args.grams_per_unit);
      if (gpu != null && (!Number.isFinite(gpu) || gpu <= 0)) {
        return { error: 'grams_per_unit must be a positive number (or null to clear)' };
      }
      patch.grams_per_unit = gpu;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'servings_per_container')) {
      const spc = normalizeServingsPerContainer(args.servings_per_container);
      if (spc.error) return { error: spc.error };
      patch.servings_per_container = spc.value;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'grams_per_ml')) {
      const density = normalizeGramsPerMl(args.grams_per_ml);
      if (density.error) return { error: density.error };
      patch.grams_per_ml = density.value;
    }
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

    const hasMicros = Object.prototype.hasOwnProperty.call(args, 'micros');
    const hasMicros100 = Object.prototype.hasOwnProperty.call(args, 'micros_per_100g');
    if (hasMicros && hasMicros100) {
      return { error: 'Pass either micros (per label serving) or micros_per_100g, not both' };
    }
    const writingMicros =
      (hasMicros && args.micros !== null) || hasMicros100;
    const clearingMicros = hasMicros && args.micros === null;
    if (Object.prototype.hasOwnProperty.call(args, 'micros_confidence') && !writingMicros && !clearingMicros) {
      return {
        error: 'micros_confidence only applies when writing micros or micros_per_100g',
      };
    }
    let microsJson = before.micros_json ?? null;
    if (clearingMicros) {
      microsJson = null;
    } else if (writingMicros) {
      const conf = normalizeMicrosConfidence(args.micros_confidence);
      if (conf.error) return { error: conf.error };
      if (hasMicros) {
        const m = microsJsonFromPerServing(args.micros, {
          confidence: conf.confidence,
          notes: 'Updated via MCP (per label serving)',
        });
        if (m.error) return { error: m.error };
        microsJson = m.micros_json;
      } else {
        if (isUnit && reads.servingGramsFor(patch) == null) {
          return {
            error:
              `micros_per_100g needs a gram weight: "${patch.name}" is counted in ${patch.unit_name || 'units'} ` +
              `and has no grams_per_unit. Set grams_per_unit, or pass micros (per label serving) instead.`,
          };
        }
        const m = microsJsonFromPer100g(args.micros_per_100g, reads.servingGramsFor(patch), {
          confidence: conf.confidence,
          notes: 'Updated via MCP (per_100g scaled to serving)',
        });
        if (m.error) return { error: m.error };
        microsJson = m.micros_json;
      }
    }

    if (!patch.name || !patch.serving_size_text) return { error: 'name and serving_size_text cannot be empty' };

    const doWrite = () => {
      db.prepare(
        `UPDATE label_ingredients
            SET name = ?, brand_name = ?, serving_size_text = ?, grams_per_serving = ?, grams_per_unit = ?,
                calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
                weight_basis = ?, nutrition_source = ?, micros_json = ?, servings_per_container = ?,
                grams_per_ml = ?
          WHERE id = ? AND user_id = ?`
      ).run(
        patch.name, patch.brand_name, patch.serving_size_text, patch.grams_per_serving, patch.grams_per_unit ?? null,
        patch.calories, patch.protein_g, patch.carbs_g, patch.fat_g, patch.fiber_g,
        patch.weight_basis, patch.nutrition_source, microsJson, patch.servings_per_container ?? null,
        patch.grams_per_ml ?? null, id, userId
      );
      scheduleIngredientMicrosCompletion(db, userId, id);
      const after = getFoodRow(db, userId, id);
      const result_row_ids = { label_ingredient_ids: [id] };
      const response = {
        op: OPS.update_food_item,
        before,
        after,
        result_row_ids,
        warnings: [],
        has_micros: !!(after?.micros_json),
      };
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
  const badKeys = rejectUnknownArgs(args, OPS.update_meal_entry);
  if (badKeys) return badKeys;
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
      if (built.error) return built;
      resolved = built.resolved;
      totals = built.totals;
      warnings = collectMealWarnings(built);
    }

    const dayBefore = daySlice(reads.getDay(db, userId, before.date));

    const doWrite = () => {
      if (hasItems) {
        softDeleteEntry(db, userId, id);
        const ids = insertMealFromResolved(db, userId, {
          date, name, explicitName: true, meal_slot, time_min, weight_basis, resolved, totals, warnings,
        });
        const after = fetchLogEntryById(db, userId, ids.log_entry_ids[0]);
        warnings.push(...droppedMicrosWarnings(db, userId, after?.ingredients));
        const result_row_ids = {
          log_entry_ids: ids.log_entry_ids,
          replaced_log_entry_id: id,
          label_ingredient_ids: ids.label_ingredient_ids,
        };
        const dayAfter = daySlice(reads.getDay(db, userId, date));
        const response = {
          op: OPS.update_meal_entry,
          before,
          after,
          day_before: dayBefore,
          day_after: dayAfter,
          items_resolved: resolved.map(it => ({
            kind: it.kind,
            name: it.name,
            label_ingredient_id: it.label_ingredient_id || null,
            recipe_id: it.recipe_id || null,
            quantity_g: it.quantity_g ?? null,
            amount: it.amount ?? null,
            unit: it.unit ?? null,
            servings: it.servings ?? null,
            resolved_weight_basis: it.resolved_weight_basis || it.weight_basis,
            macros: it.macros,
          })),
          result_row_ids,
          warnings,
          note:
            'Item changes soft-delete the previous log_entry_id and insert a new row; ' +
            'revert_mcp_write restores the old id.',
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
          WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, 0) = 0`
      ).run(date, time_min, meal_slot ? `slot:${meal_slot}` : null, name, weight_basis, id, userId);
      const after = fetchLogEntryById(db, userId, id);
      const result_row_ids = { log_entry_ids: [id] };
      const dayAfter = daySlice(reads.getDay(db, userId, date));
      const response = {
        op: OPS.update_meal_entry,
        before,
        after,
        day_before: dayBefore,
        day_after: dayAfter,
        result_row_ids,
        warnings: [],
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.update_meal_entry, operationId, before, after, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : runWriteTx(db, doWrite);
  });
}

function deleteMealEntry(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.delete_meal_entry);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const id = Number(args.log_entry_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'log_entry_id is required' };
    const before = fetchLogEntryById(db, userId, id);
    if (!before) return { error: `log_entry_id ${id} not found` };

    const dayBefore = daySlice(reads.getDay(db, userId, before.date));

    const doWrite = () => {
      softDeleteEntry(db, userId, id);
      const result_row_ids = { deleted_log_entry_ids: [id] };
      const dayAfter = daySlice(reads.getDay(db, userId, before.date));
      const response = {
        op: OPS.delete_meal_entry,
        before,
        after: null,
        day_before: dayBefore,
        day_after: dayAfter,
        result_row_ids,
        warnings: [],
        soft_deleted: true,
        message: 'Soft-deleted. Use revert_mcp_write(audit_id) to restore.',
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

const MEAL_PREP_SOURCE = 'mcp_meal_prep';
const MAX_MEAL_PREP_SERVINGS = 50;

function fetchRecipeById(db, userId, id) {
  const row = db
    .prepare(
      `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
              recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta,
              COALESCE(is_deleted, 0) AS is_deleted
         FROM recipes WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return null;
  return {
    ...row,
    ingredients: parseJson(row.ingredients, []),
    meal_builder_meta: parseJson(row.meal_builder_meta, null),
  };
}

/**
 * Create an equal-split meal prep: a limited-use recipe with one use per
 * container. Items are the WHOLE batch (what goes in the pot); the stored
 * recipe holds one container's share — the same model the app's
 * "Save as Meal Prep" writes (per-serving macros + amounts, N uses).
 * New per-100g foods become library ingredients so every line stays
 * library-backed and editable.
 */
function createMealPrep(db, userId, args = {}, { skipAudit = false, refMap = null } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.create_meal_prep);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const name = String(args.name || '').trim();
    if (!name) return { error: 'name is required' };
    const servings = Number(args.servings);
    if (!Number.isInteger(servings) || servings < 2 || servings > MAX_MEAL_PREP_SERVINGS) {
      return { error: `servings must be an integer 2–${MAX_MEAL_PREP_SERVINGS} (number of containers)` };
    }
    const weight_basis = normalizeWeightBasis(args.weight_basis);
    if (!weight_basis) return { error: 'weight_basis is required (raw|cooked)' };
    const itemsIn = Array.isArray(args.items) ? args.items : null;
    if (!itemsIn || !itemsIn.length) return { error: 'items must be a non-empty array' };

    const resolved = [];
    const warnings = [];
    for (let i = 0; i < itemsIn.length; i++) {
      if (itemsIn[i]?.recipe_id != null) {
        return { error: `items[${i}]: meal prep items must be ingredients (label_ingredient_id, ref, or new per-100g food), not recipes` };
      }
      const r = resolveMealItem(db, userId, itemsIn[i], weight_basis, i, refMap);
      if (r.error) return { error: r.error };
      resolved.push(r.item);
      warnings.push(...(r.warnings || []));
    }

    const batchTotals = sumItemMacros(resolved);
    const perServing = {
      calories: round(batchTotals.calories / servings, 1),
      protein_g: round(batchTotals.protein_g / servings, 2),
      carbs_g: round(batchTotals.carbs_g / servings, 2),
      fat_g: round(batchTotals.fat_g / servings, 2),
      fiber_g: batchTotals.fiber_g == null ? null : round(batchTotals.fiber_g / servings, 2),
    };
    // Quantity checks are tuned for one meal, so judge a container's share,
    // not the whole pot (1.5kg of chicken across 5 containers is normal).
    warnings.push(...warningsForMealTotals(
      perServing,
      resolved.map(it => ({ ...it, quantity_g: it.quantity_g == null ? null : it.quantity_g / servings }))
    ));
    const sameName = db
      .prepare(
        `SELECT id FROM recipes
          WHERE user_id = ? AND lower(name) = lower(?) AND COALESCE(is_deleted, 0) = 0
            AND COALESCE(is_quick_food, 0) = 0`
      )
      .all(userId, name);
    if (sameName.length) {
      warnings.push(`A recipe named "${name}" already exists (id ${sameName.map(r => r.id).join(', ')}).`);
    }

    const doWrite = () => {
      const label_ingredient_ids = [];
      const ingredients = resolved.map(item => {
        let lid = item.label_ingredient_id;
        if (item.kind === 'new_food') {
          lid = createLabelFromNewFood(db, userId, item);
          label_ingredient_ids.push(lid);
        }
        return {
          kind: 'ingredient',
          name: item.name,
          // Counts keep 2 decimals (4 eggs / 3 = 1.33 egg); grams keep 1.
          amount: String(round(item.amount / servings, item.unit === 'g' ? 1 : 2)),
          unit: item.unit,
          label_ingredient_id: lid,
        };
      });
      warnings.push(...droppedMicrosWarnings(db, userId, ingredients));
      const meta = {
        source: MEAL_PREP_SOURCE,
        containers: servings,
        split: 'equal',
        weight_basis,
      };
      const ins = db
        .prepare(
          `INSERT INTO recipes (
             user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
             recipe_kind, remaining_uses, max_uses, is_archived, meal_builder_meta, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'limited', ?, ?, 0, ?, ?)`
        )
        .run(
          userId, name, `1 of ${servings} meal-prep servings`,
          perServing.calories, perServing.protein_g, perServing.carbs_g, perServing.fat_g, perServing.fiber_g,
          JSON.stringify(ingredients), servings, servings, JSON.stringify(meta), nowIso()
        );
      const recipeId = ins.lastInsertRowid;
      const recipe = fetchRecipeById(db, userId, recipeId);
      const result_row_ids = { recipe_ids: [recipeId], label_ingredient_ids };
      const deduped = [...new Set(warnings)];
      const response = {
        op: OPS.create_meal_prep,
        recipe,
        servings,
        per_serving: perServing,
        batch_totals: batchTotals,
        resolved_items: resolved.map(it => ({
          name: it.name,
          batch_amount: it.amount,
          per_serving_amount: round(it.amount / servings, it.unit === 'g' ? 1 : 2),
          unit: it.unit,
          batch_quantity_g: it.quantity_g ?? null,
          per_serving_quantity_g: it.quantity_g == null ? null : round(it.quantity_g / servings, 1),
          resolved_weight_basis: it.resolved_weight_basis,
          nutrition_source: it.nutrition_source,
        })),
        result_row_ids,
        warnings: deduped,
        source: 'mcp',
        message:
          `Meal prep saved: ${servings} servings. Log one container with log_meal ` +
          `items=[{recipe_id: ${recipeId}, servings: 1}].`,
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.create_meal_prep, operationId, before: null, after: recipe,
          result_row_ids, warnings: deduped, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

const MIN_BODY_KG = 20;
const MAX_BODY_KG = 300;
/** A jump this big from the previous weigh-in is worth a second look (warn, never block). */
const BODY_WEIGHT_JUMP_KG = 3;

const toLb = kg => round(kg * LB_PER_KG, 1);

/**
 * Log a weigh-in for a date (default: server-local today). Same storage and
 * same-date OVERWRITE as the Dashboard (shared upsertBodyWeight); the replaced
 * value is returned and restored by revert_mcp_write.
 */
function logBodyWeight(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.log_body_weight);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const unit = String(args.unit || '').trim().toLowerCase();
    if (unit !== 'lb' && unit !== 'kg') return { error: 'unit is required: "lb" or "kg"' };
    const weight = Number(args.weight);
    if (!Number.isFinite(weight) || weight <= 0) return { error: 'weight must be a positive number' };
    // Full precision, exactly as the app stores a typed value (lb ÷ 2.20462).
    const weight_kg = unit === 'lb' ? weight / LB_PER_KG : weight;
    if (weight_kg < MIN_BODY_KG || weight_kg > MAX_BODY_KG) {
      return {
        error:
          `${weight} ${unit} is outside the accepted range ` +
          `(${MIN_BODY_KG}–${MAX_BODY_KG} kg / ${toLb(MIN_BODY_KG)}–${toLb(MAX_BODY_KG)} lb). Nothing was written.`,
        code: 'OUT_OF_RANGE',
      };
    }
    if (args.date != null && !isoDateOrNull(args.date)) return { error: 'date must be YYYY-MM-DD' };
    const date = isoDateOrNull(args.date) || getLocalDateISO();

    const previousRow = db
      .prepare(
        `SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1`
      )
      .get(userId, date);
    const warnings = [];
    if (previousRow && Math.abs(weight_kg - previousRow.weight_kg) > BODY_WEIGHT_JUMP_KG) {
      warnings.push(
        `${round(weight_kg, 2)} kg differs from the previous weigh-in (${round(previousRow.weight_kg, 2)} kg on ` +
        `${previousRow.date}) by more than ${BODY_WEIGHT_JUMP_KG} kg — check the number and unit.`
      );
    }

    const doWrite = () => {
      const { before, after } = upsertBodyWeight(db, userId, date, weight_kg, 'mcp');
      const shape = row => row && {
        date: row.date,
        weight_kg: round(row.weight_kg, 2),
        weight_lb: toLb(row.weight_kg),
        source: row.source,
      };
      const result_row_ids = { body_weight_dates: [date] };
      const response = {
        op: OPS.log_body_weight,
        date,
        weight_kg: round(after.weight_kg, 2),
        weight_lb: toLb(after.weight_kg),
        input: { weight, unit },
        replaced: shape(before),
        before,
        after,
        previous_weigh_in: previousRow
          ? { date: previousRow.date, weight_kg: round(previousRow.weight_kg, 2), weight_lb: toLb(previousRow.weight_kg) }
          : null,
        result_row_ids,
        warnings,
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.log_body_weight, operationId, before, after, result_row_ids, warnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

// ── Maintenance calories (profile) ───────────────────────────────────────────
// The profile's stated maintenance — the number the Profile page and the PDF
// report show. Separate from estimate_maintenance, which only reads.

const MIN_MAINTENANCE_KCAL = 1000;
const MAX_MAINTENANCE_KCAL = 6000;

function readMaintenance(db, userId) {
  const row = db.prepare('SELECT maintenance_calories FROM user_profile WHERE user_id = ?').get(userId);
  return row?.maintenance_calories ?? null;
}

function setMaintenanceCalories(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.set_maintenance_calories);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const kcal = args.maintenance_calories === null ? null : Number(args.maintenance_calories);
    if (kcal !== null && (!Number.isFinite(kcal) || kcal < MIN_MAINTENANCE_KCAL || kcal > MAX_MAINTENANCE_KCAL)) {
      return {
        error: `maintenance_calories must be ${MIN_MAINTENANCE_KCAL}–${MAX_MAINTENANCE_KCAL} kcal (or null to clear). Nothing was written.`,
        code: 'OUT_OF_RANGE',
      };
    }
    const value = kcal === null ? null : Math.round(kcal);
    const doWrite = () => {
      const before = { maintenance_calories: readMaintenance(db, userId) };
      db.prepare(
        `INSERT INTO user_profile (user_id, maintenance_calories) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET maintenance_calories = excluded.maintenance_calories`
      ).run(userId, value);
      const after = { maintenance_calories: readMaintenance(db, userId) };
      const result_row_ids = { profile_user_ids: [userId] };
      const response = {
        op: OPS.set_maintenance_calories,
        maintenance_calories: after.maintenance_calories,
        previous: before.maintenance_calories,
        before,
        after,
        result_row_ids,
        warnings: [],
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.set_maintenance_calories, operationId, before, after, result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : db.transaction(doWrite)();
  });
}

// ── Diet phases (calendar badges) ────────────────────────────────────────────
// Storage is shared with /api/diet-phases (server/dietPhases.js). Deletes are
// soft so every one of these is revertible.

function phaseResponse(db, userId, op, { phase, before, after, warnings = [] }) {
  const today = getLocalDateISO();
  // Return the phase with its resolved end, as the calendar will show it.
  const id = (phase || after || before)?.id;
  const resolved = id
    ? dietPhases.listPhases(db, userId, { today }).find(p => p.id === id) || null
    : null;
  return {
    op,
    diet_phase: resolved || phase || after || null,
    before: before ?? null,
    after: after ?? phase ?? null,
    result_row_ids: { diet_phase_ids: id ? [id] : [] },
    warnings,
    source: 'mcp',
  };
}

function overlapWarnings(db, userId, phase) {
  if (!phase) return [];
  const today = getLocalDateISO();
  return dietPhases
    .listPhases(db, userId, { start: phase.start_date, end: phase.end_date || phase.start_date, today })
    .filter(p => p.id !== phase.id && p.start_date === phase.start_date
      && String(p.label || '').toLowerCase() === String(phase.label || '').toLowerCase())
    .map(p => `Another "${p.label}" phase (#${p.id}) already starts on ${p.start_date} — possible duplicate.`);
}

function addDietPhase(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.add_diet_phase);
  if (badKeys) return badKeys;
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const doWrite = () => {
      const { op: _op, operation_id: _oid, ...input } = args;
      const r = dietPhases.createPhase(db, userId, input, 'mcp');
      if (r.error) return { error: r.error, code: 'INVALID' };
      const warnings = overlapWarnings(db, userId, r.phase);
      const response = phaseResponse(db, userId, OPS.add_diet_phase, { phase: r.phase, after: r.phase, warnings });
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.add_diet_phase, operationId, before: null, after: r.phase,
          result_row_ids: response.result_row_ids, warnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : runWriteTx(db, doWrite);
  });
}

function updateDietPhase(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.update_diet_phase);
  if (badKeys) return badKeys;
  const id = Number(args.diet_phase_id);
  if (!Number.isInteger(id) || id <= 0) return { error: 'diet_phase_id is required' };
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const doWrite = () => {
      const { op: _op, operation_id: _oid, diet_phase_id: _id, ...patch } = args;
      if (!Object.keys(patch).length) {
        return { error: 'Nothing to update: pass kind, label, start_date, end_date, or notes' };
      }
      const r = dietPhases.updatePhase(db, userId, id, patch, 'mcp');
      if (r.error) return { error: r.error, code: r.status === 404 ? 'NOT_FOUND' : 'INVALID' };
      const warnings = overlapWarnings(db, userId, r.after);
      const response = phaseResponse(db, userId, OPS.update_diet_phase, { before: r.before, after: r.after, warnings });
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.update_diet_phase, operationId, before: r.before, after: r.after,
          result_row_ids: response.result_row_ids, warnings, response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : runWriteTx(db, doWrite);
  });
}

function deleteDietPhase(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.delete_diet_phase);
  if (badKeys) return badKeys;
  const id = Number(args.diet_phase_id);
  if (!Number.isInteger(id) || id <= 0) return { error: 'diet_phase_id is required' };
  const operationId = args.operation_id ? String(args.operation_id).trim() : null;
  return withIdempotency(db, userId, operationId, () => {
    const doWrite = () => {
      const before = dietPhases.getPhase(db, userId, id);
      if (!before) return { error: `Diet phase #${id} not found`, code: 'NOT_FOUND' };
      dietPhases.setPhaseDeleted(db, userId, id, true);
      const after = dietPhases.getPhase(db, userId, id, { includeDeleted: true });
      const response = {
        op: OPS.delete_diet_phase,
        deleted: before,
        before,
        after,
        result_row_ids: { diet_phase_ids: [id] },
        warnings: [],
        source: 'mcp',
      };
      if (!skipAudit) {
        response.audit_id = recordAudit(db, userId, {
          op: OPS.delete_diet_phase, operationId, before, after,
          result_row_ids: response.result_row_ids, warnings: [], response,
        });
      }
      return response;
    };
    return skipAudit ? doWrite() : runWriteTx(db, doWrite);
  });
}

const PHASE_SNAPSHOT_KEYS = ['kind', 'label', 'start_date', 'end_date', 'notes', 'is_deleted'];

/** Undo only what MCP wrote: refuse if the phase was changed since (e.g. in the app). */
function assertPhaseUnchanged(db, userId, snap) {
  const current = dietPhases.getPhase(db, userId, snap.id, { includeDeleted: true });
  const same = current && PHASE_SNAPSHOT_KEYS.every(k => (current[k] ?? null) === (snap[k] ?? null));
  if (!same) {
    throw Object.assign(
      new Error(`Diet phase #${snap.id} changed after this MCP write; not reverting.`),
      { code: 'NOT_REVERTIBLE' }
    );
  }
}

function revertDietPhaseResult(db, userId, result) {
  const op = result.op;
  if (op === OPS.add_diet_phase && result.after?.id) {
    assertPhaseUnchanged(db, userId, result.after);
    dietPhases.setPhaseDeleted(db, userId, result.after.id, true);
  } else if ((op === OPS.update_diet_phase || op === OPS.delete_diet_phase) && result.before?.id) {
    if (result.after?.id) assertPhaseUnchanged(db, userId, result.after);
    dietPhases.restorePhase(db, userId, result.before);
  }
}

function shapeSupplement(db, userId, id) {
  const row = db
    .prepare(
      `SELECT id, name, dose_text, label_serving_qty, label_serving_unit, dose_qty,
              calories, protein_g, carbs_g, fat_g, micros_json, counts_toward_macros,
              is_deleted, created_via
         FROM supplements WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return null;
  let micros = null;
  if (row.micros_json) {
    try {
      const p = typeof row.micros_json === 'string' ? JSON.parse(row.micros_json) : row.micros_json;
      if (p?.micros && typeof p.micros === 'object') micros = p.micros;
    } catch {
      micros = null;
    }
  }
  const { micros_json, ...rest } = row;
  return {
    ...rest,
    is_deleted: Number(row.is_deleted) === 1,
    dose_multiplier: doseMultiplier({
      label_serving_qty: row.label_serving_qty,
      dose_qty: row.dose_qty,
    }),
    per_label_serving: {
      calories: row.calories,
      protein_g: row.protein_g,
      carbs_g: row.carbs_g,
      fat_g: row.fat_g,
      micros,
    },
  };
}

function normalizeMicrosPatch(raw) {
  if (raw === null) return { micros_json: null };
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'micros must be an object of nutrient → amount, or null to clear' };
  }
  const blob = buildMicrosBlob(raw, {
    confidence: 'high',
    notes: 'Updated via MCP (label data)',
  });
  if (!blob) {
    return {
      error:
        'micros contained no recognized nutrient keys with positive values ' +
        '(keys must match the FLOPS micro set, e.g. sodium_mg, vitamin_d_mcg)',
    };
  }
  return { micros_json: JSON.stringify(blob) };
}

function updateSupplement(db, userId, args = {}, { skipAudit = false } = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.update_supplement);
  if (badKeys) return badKeys;
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

    const nutritionPatch = {
      calories: args.calories !== undefined ? Number(args.calories) : before.calories,
      protein_g: args.protein_g !== undefined ? Number(args.protein_g) : before.protein_g,
      carbs_g: args.carbs_g !== undefined ? Number(args.carbs_g) : before.carbs_g,
      fat_g: args.fat_g !== undefined ? Number(args.fat_g) : before.fat_g,
    };
    for (const [k, v] of Object.entries(nutritionPatch)) {
      if (args[k] !== undefined && (!Number.isFinite(v) || v < 0)) {
        return { error: `${k} must be a non-negative number` };
      }
    }

    let microsJson = null;
    let microsTouched = false;
    if (Object.prototype.hasOwnProperty.call(args, 'micros')) {
      microsTouched = true;
      const m = normalizeMicrosPatch(args.micros);
      if (m.error) return { error: m.error };
      microsJson = m.micros_json;
    }

    const nutritionTouched =
      args.calories !== undefined ||
      args.protein_g !== undefined ||
      args.carbs_g !== undefined ||
      args.fat_g !== undefined ||
      microsTouched;

    const takenDate = args.taken_date ? isoDateOrNull(args.taken_date) : null;
    if (args.taken_date && !takenDate) return { error: 'taken_date must be YYYY-MM-DD' };
    const hasTaken = Object.prototype.hasOwnProperty.call(args, 'taken');

    const doWrite = () => {
      if (nutritionTouched) {
        if (microsTouched) {
          db.prepare(
            `UPDATE supplements
                SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?,
                    calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, micros_json = ?
              WHERE id = ? AND user_id = ?`
          ).run(
            afterDose.dose_text, afterDose.dose_qty, afterDose.label_serving_qty,
            afterDose.label_serving_unit,
            nutritionPatch.calories, nutritionPatch.protein_g, nutritionPatch.carbs_g, nutritionPatch.fat_g,
            microsJson, id, userId
          );
        } else {
          db.prepare(
            `UPDATE supplements
                SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?,
                    calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?
              WHERE id = ? AND user_id = ?`
          ).run(
            afterDose.dose_text, afterDose.dose_qty, afterDose.label_serving_qty,
            afterDose.label_serving_unit,
            nutritionPatch.calories, nutritionPatch.protein_g, nutritionPatch.carbs_g, nutritionPatch.fat_g,
            id, userId
          );
        }
      } else {
        db.prepare(
          `UPDATE supplements
              SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?
            WHERE id = ? AND user_id = ?`
        ).run(
          afterDose.dose_text, afterDose.dose_qty, afterDose.label_serving_qty,
          afterDose.label_serving_unit, id, userId
        );
      }

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
      const response = {
        op: OPS.update_supplement,
        before,
        after,
        taken,
        result_row_ids,
        warnings: [],
        historical_totals_recalculate: nutritionTouched,
        note: nutritionTouched
          ? 'Per-label-serving macros/micros changed. Past days that took this supplement recalculate on read (live dose scaling) — meal logs are unaffected.'
          : undefined,
      };
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
  const badKeys = rejectUnknownArgs(args, OPS.write_batch);
  if (badKeys) return badKeys;
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
          const stepBad = rejectUnknownArgs(step, op);
          if (stepBad) {
            throw Object.assign(new Error(`operations[${i}]: ${stepBad.error}`), {
              code: stepBad.code || 'UNKNOWN_PARAM',
            });
          }
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
          } else if (op === OPS.create_meal_prep) {
            result = createMealPrep(db, userId, step, { skipAudit: true, refMap });
          } else if (op === OPS.log_body_weight) {
            result = logBodyWeight(db, userId, step, { skipAudit: true });
          } else if (op === OPS.set_maintenance_calories) {
            result = setMaintenanceCalories(db, userId, step, { skipAudit: true });
          } else if (op === OPS.add_diet_phase) {
            result = addDietPhase(db, userId, step, { skipAudit: true });
          } else if (op === OPS.update_diet_phase) {
            result = updateDietPhase(db, userId, step, { skipAudit: true });
          } else if (op === OPS.delete_diet_phase) {
            result = deleteDietPhase(db, userId, step, { skipAudit: true });
          } else {
            throw Object.assign(new Error(`operations[${i}]: unsupported op "${op}"`), { code: 'BAD_OP' });
          }
          if (result?.error) {
            throw Object.assign(new Error(`operations[${i}]: ${result.error}`), {
              code: result.code || 'OP_FAILED',
              unknown: result.unknown,
            });
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
          recipe_ids: results.flatMap(r => r.result_row_ids?.recipe_ids || []),
          body_weight_dates: results.flatMap(r => r.result_row_ids?.body_weight_dates || []),
          diet_phase_ids: results.flatMap(r => r.result_row_ids?.diet_phase_ids || []),
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
      const out = { error: e.message || 'write_batch failed' };
      if (e.code) out.code = e.code;
      if (e.unknown) out.unknown = e.unknown;
      return out;
    }
  });
}

function restoreMealFromBefore(db, userId, before) {
  if (!before || !before.date) {
    throw Object.assign(new Error('Cannot restore meal — before snapshot incomplete'), { code: 'NO_BEFORE' });
  }
  const macros = before.per_serving || before.logged || {};
  const calories = Number(macros.calories) || 0;
  const protein_g = Number(macros.protein_g) || 0;
  const carbs_g = Number(macros.carbs_g) || 0;
  const fat_g = Number(macros.fat_g) || 0;
  const fiber_g = macros.fiber_g == null ? null : Number(macros.fiber_g);
  const name = before.recipe_name || 'Restored meal';
  const recipeId = before.recipe_id
    ? before.recipe_id
    : ensureQuickFoodRecipe(db, userId, name, { calories, protein_g, carbs_g, fat_g, fiber_g });
  const servings = Number(before.servings) || 1;
  const ingredients_json = before.ingredients ? JSON.stringify(before.ingredients) : null;
  const ins = db
    .prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, notes,
         recipe_name, serving_size, recipe_calories, recipe_protein_g, recipe_carbs_g,
         recipe_fat_g, recipe_fiber_g, recipe_is_quick_food, slot_selections_json,
         ingredients_json, source, weight_basis, nutrition_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(
      userId,
      recipeId,
      before.date,
      before.time_min ?? null,
      servings,
      before.notes ?? null,
      name,
      before.serving_size || '1 serving',
      calories,
      protein_g,
      carbs_g,
      fat_g,
      fiber_g,
      before.is_quick_food ? 1 : 0,
      ingredients_json,
      before.source || 'mcp',
      before.weight_basis || null,
      before.nutrition_source || null
    );
  return ins.lastInsertRowid;
}

function revertOneResult(db, userId, result) {
  const op = result?.op;
  const ids = result?.result_row_ids || {};
  if (op === OPS.add_diet_phase || op === OPS.update_diet_phase || op === OPS.delete_diet_phase) {
    revertDietPhaseResult(db, userId, result);
    return;
  }
  if (op === OPS.delete_meal_entry) {
    for (const id of ids.deleted_log_entry_ids || []) undeleteEntry(db, userId, id);
    return;
  }
  if (op === OPS.add_food_item) {
    for (const id of ids.label_ingredient_ids || [result.label_ingredient_id]) {
      if (id) {
        db.prepare(
          `DELETE FROM label_ingredients WHERE id = ? AND user_id = ? AND created_via = 'mcp'`
        ).run(id, userId);
      }
    }
    return;
  }
  if (op === OPS.create_meal_prep) {
    // Soft-delete: logged containers keep pointing at the recipe row.
    for (const id of ids.recipe_ids || []) {
      db.prepare(
        `UPDATE recipes SET is_deleted = 1 WHERE id = ? AND user_id = ?`
      ).run(id, userId);
    }
    for (const id of ids.label_ingredient_ids || []) {
      db.prepare(
        `DELETE FROM label_ingredients WHERE id = ? AND user_id = ? AND created_via = 'mcp'`
      ).run(id, userId);
    }
    return;
  }
  if (op === OPS.set_maintenance_calories) {
    // Undo only what MCP wrote: if the value changed since (edited on the
    // Profile page), refuse rather than overwrite the newer number.
    const current = readMaintenance(db, userId);
    const wrote = result.after?.maintenance_calories ?? null;
    if (current !== wrote) {
      throw Object.assign(
        new Error(`Maintenance calories changed after this MCP write (now ${current ?? 'unset'}); not reverting.`),
        { code: 'NOT_REVERTIBLE' }
      );
    }
    db.prepare('UPDATE user_profile SET maintenance_calories = ? WHERE user_id = ?')
      .run(result.before?.maintenance_calories ?? null, userId);
    return;
  }
  if (op === OPS.log_body_weight) {
    // Undo only what MCP wrote: if the row changed since (re-entered in the
    // app), refuse rather than discard the newer weigh-in.
    const wrote = result.after || (result.date ? { date: result.date } : null);
    const date = wrote?.date;
    if (!date) return;
    const current = getBodyWeight(db, userId, date);
    if (current && wrote.weight_kg != null &&
        (current.source !== 'mcp' || Math.abs(current.weight_kg - wrote.weight_kg) > 1e-9)) {
      throw Object.assign(
        new Error(`The ${date} weigh-in changed after this MCP write (now ${round(current.weight_kg, 2)} kg, ${current.source}); not reverting.`),
        { code: 'NOT_REVERTIBLE' }
      );
    }
    if (result.before) {
      upsertBodyWeight(db, userId, date, result.before.weight_kg, result.before.source || 'app');
    } else {
      db.prepare('DELETE FROM body_weights WHERE user_id = ? AND date = ?').run(userId, date);
    }
    return;
  }
  if (op === OPS.update_food_item && result.before) {
    const b = result.before;
    db.prepare(
      `UPDATE label_ingredients
          SET name = ?, brand_name = ?, serving_size_text = ?, grams_per_serving = ?,
              calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
              weight_basis = ?, nutrition_source = ?, micros_json = ?
        WHERE id = ? AND user_id = ?`
    ).run(
      b.name, b.brand_name, b.serving_size_text, b.grams_per_serving,
      b.calories, b.protein_g, b.carbs_g, b.fat_g, b.fiber_g,
      b.weight_basis, b.nutrition_source, b.micros_json ?? null, b.id, userId
    );
    // Audits written before grams_per_unit was snapshotted don't carry it — leave it alone then.
    if (Object.prototype.hasOwnProperty.call(b, 'grams_per_unit')) {
      db.prepare('UPDATE label_ingredients SET grams_per_unit = ? WHERE id = ? AND user_id = ?')
        .run(b.grams_per_unit ?? null, b.id, userId);
    }
    if (Object.prototype.hasOwnProperty.call(b, 'servings_per_container')) {
      db.prepare('UPDATE label_ingredients SET servings_per_container = ? WHERE id = ? AND user_id = ?')
        .run(b.servings_per_container ?? null, b.id, userId);
    }
    if (Object.prototype.hasOwnProperty.call(b, 'grams_per_ml')) {
      db.prepare('UPDATE label_ingredients SET grams_per_ml = ? WHERE id = ? AND user_id = ?')
        .run(b.grams_per_ml ?? null, b.id, userId);
    }
    return;
  }
  if (op === OPS.update_supplement && result.before) {
    const b = result.before;
    const microsJson =
      b.per_label_serving?.micros != null
        ? JSON.stringify({
            micros: b.per_label_serving.micros,
            confidence: 'high',
            notes: 'Restored via MCP revert',
          })
        : null;
    db.prepare(
      `UPDATE supplements
          SET dose_text = ?, dose_qty = ?, label_serving_qty = ?, label_serving_unit = ?,
              calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, micros_json = ?
        WHERE id = ? AND user_id = ?`
    ).run(
      b.dose_text,
      b.dose_qty,
      b.label_serving_qty,
      b.label_serving_unit,
      b.calories ?? b.per_label_serving?.calories ?? 0,
      b.protein_g ?? b.per_label_serving?.protein_g ?? 0,
      b.carbs_g ?? b.per_label_serving?.carbs_g ?? 0,
      b.fat_g ?? b.per_label_serving?.fat_g ?? 0,
      microsJson,
      b.id,
      userId
    );
    return;
  }
  if (op === OPS.update_meal_entry) {
    if (ids.replaced_log_entry_id) {
      for (const id of ids.log_entry_ids || []) softDeleteEntry(db, userId, id);
    }
    for (const id of ids.label_ingredient_ids || []) {
      db.prepare(
        `DELETE FROM label_ingredients WHERE id = ? AND user_id = ? AND created_via = 'mcp'`
      ).run(id, userId);
    }
    if (ids.replaced_log_entry_id) {
      undeleteEntry(db, userId, ids.replaced_log_entry_id);
    } else if (result.before && !ids.replaced_log_entry_id) {
      // Metadata-only update: restore fields on the same id
      const b = result.before;
      db.prepare(
        `UPDATE log_entries
            SET date = ?, time_min = ?, notes = ?, recipe_name = ?, weight_basis = ?, is_deleted = 0
          WHERE id = ? AND user_id = ?`
      ).run(
        b.date,
        b.time_min ?? null,
        b.notes ?? null,
        b.recipe_name,
        b.weight_basis || null,
        b.id,
        userId
      );
    }
    return;
  }
  if (op === OPS.log_meal) {
    for (const id of ids.log_entry_ids || []) softDeleteEntry(db, userId, id);
    for (const id of ids.label_ingredient_ids || []) {
      db.prepare(
        `DELETE FROM label_ingredients WHERE id = ? AND user_id = ? AND created_via = 'mcp'`
      ).run(id, userId);
    }
  }
}

function revertMcpWrite(db, userId, args = {}) {
  const badKeys = rejectUnknownArgs(args, OPS.revert_mcp_write);
  if (badKeys) return badKeys;
  const auditId = Number(args.audit_id);
  if (!Number.isInteger(auditId) || auditId <= 0) return { error: 'audit_id is required' };

  const row = db
    .prepare('SELECT * FROM mcp_write_audit WHERE id = ? AND user_id = ?')
    .get(auditId, userId);
  if (!row) return { error: `audit_id ${auditId} not found` };
  if (row.reverted_at) {
    return { error: 'This audit entry was already reverted', code: 'ALREADY_REVERTED', reverted_at: row.reverted_at };
  }

  const op = row.op || row.kind;
  const before = parseJson(row.before_json, null);
  const after = parseJson(row.after_json, null);
  const result_row_ids = parseJson(row.result_row_ids_json, {});
  const storedResponse = parseJson(row.response_json, null);

  // Legacy hard-delete audits (pre soft-delete) cannot be restored.
  if (op === OPS.delete_meal_entry) {
    const ids = result_row_ids.deleted_log_entry_ids || [];
    const stillThere = ids.filter(id =>
      db.prepare('SELECT id FROM log_entries WHERE id = ? AND user_id = ?').get(id, userId)
    );
    if (!stillThere.length && before) {
      return {
        error:
          'This delete was a hard delete (pre soft-delete). The meal row is gone and cannot be restored.',
        code: 'NOT_REVERTIBLE',
      };
    }
  }

  try {
    const run = db.transaction(() => {
      if (op === OPS.write_batch) {
        const results = storedResponse?.results || [];
        for (let i = results.length - 1; i >= 0; i--) {
          revertOneResult(db, userId, results[i]);
        }
      } else {
        revertOneResult(db, userId, {
          op,
          before,
          after,
          result_row_ids,
          label_ingredient_id: storedResponse?.label_ingredient_id,
        });
      }

      db.prepare(
        `UPDATE mcp_write_audit SET reverted_at = ? WHERE id = ? AND user_id = ?`
      ).run(nowIso(), auditId, userId);

      const response = {
        op: OPS.revert_mcp_write,
        reverted_audit_id: auditId,
        reverted_op: op,
        ok: true,
        message: `Reverted ${op} (audit_id ${auditId}).`,
      };
      response.audit_id = recordAudit(db, userId, {
        op: OPS.revert_mcp_write,
        operationId: args.operation_id ? String(args.operation_id).trim() : null,
        before: { audit_id: auditId, op, before, after },
        after: { reverted: true },
        result_row_ids: { reverted_audit_ids: [auditId] },
        warnings: [],
        response,
      });
      return response;
    });
    return run();
  } catch (e) {
    if (e.code === 'NOT_REVERTIBLE' || e.code === 'LIMIT_USES') {
      return { error: e.message, code: e.code };
    }
    return { error: e.message || 'Revert failed' };
  }
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
          AND COALESCE(is_deleted, 0) = 0
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
      `SELECT id AS audit_id, kind, op, operation_id, created_at, reverted_at,
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
      reverted_at: a.reverted_at || null,
      before: parseJson(a.before_json, null),
      after: parseJson(a.after_json, parseJson(a.preview_json, null)),
      result_row_ids: parseJson(a.result_row_ids_json, {}),
      warnings: parseJson(a.warnings_json, []),
    }));

  const diet_phases = db
    .prepare(
      `SELECT id, kind, label, start_date, end_date, notes, updated_at
         FROM diet_phases
        WHERE user_id = ? AND source = 'mcp' AND COALESCE(is_deleted, 0) = 0
        ORDER BY id DESC LIMIT 100`
    )
    .all(userId);

  return { days, since, meals, foods, diet_phases, audits };
}

function bulkDeleteMcpLogEntries(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map(() => '?').join(',');
  const owned = db
    .prepare(
      `SELECT id FROM log_entries
        WHERE user_id = ? AND source = 'mcp' AND COALESCE(is_deleted, 0) = 0
          AND id IN (${placeholders})`
    )
    .all(userId, ...list)
    .map(r => r.id);
  if (!owned.length) return { deleted: 0, skipped: list.length };
  const ph2 = owned.map(() => '?').join(',');
  const r = db
    .prepare(`UPDATE log_entries SET is_deleted = 1 WHERE user_id = ? AND id IN (${ph2})`)
    .run(userId, ...owned);
  return { deleted: r.changes, ids: owned, soft_deleted: true };
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

/**
 * The caller-facing shape of an update_food_item result: only what changed.
 * The full before/after rows (micros_json and all) stay in the audit row and
 * in a write_batch's stored response, because revert reads them from there —
 * this only trims what goes back over MCP, where a density tweak used to echo
 * two copies of every micronutrient.
 */
function compactFoodUpdate(result) {
  if (!result || result.error || result.op !== OPS.update_food_item || !result.before) return result;
  const { before, after = {}, ...rest } = result;
  const changed = {};
  for (const key of Object.keys(after)) {
    if (key === 'micros_json') continue;
    if (before[key] !== after[key]) changed[key] = { before: before[key] ?? null, after: after[key] ?? null };
  }
  const out = {
    ...rest,
    label_ingredient_id: after.id ?? before.id,
    name: after.name ?? before.name,
    changed,
  };
  if (before.micros_json !== after.micros_json) {
    const was = parseJson(before.micros_json, null)?.micros || {};
    const now = parseJson(after.micros_json, null)?.micros || {};
    const micros = {};
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[key] !== now[key]) micros[key] = { before: was[key] ?? null, after: now[key] ?? null };
    }
    out.micros_changed = micros;
  }
  return out;
}

/** A log entry reduced to what identifies it: no ingredients, no micros. */
function entrySummary(entry) {
  if (!entry) return entry ?? null;
  return { id: entry.id, name: entry.recipe_name, date: entry.date, servings: entry.servings, logged: entry.logged };
}

/**
 * Caller-facing shape of a meal update/delete. The removed (or replaced) entry
 * shrinks to a summary and only the day AFTER the write is returned — the full
 * before/after entries and both days stay in the audit row for revert. An
 * update keeps its full `after`: the new ingredients are the point of the call.
 */
function compactMealWrite(result) {
  if (!result || result.error) return result;
  if (result.op !== OPS.delete_meal_entry && result.op !== OPS.update_meal_entry) return result;
  // items_resolved repeats after.ingredients; drop it with day_before.
  const { before, day_before: _dayBefore, day_after: dayAfter, items_resolved: _items, ...rest } = result;
  const out = { ...rest, before: entrySummary(before) };
  if (dayAfter) out.day = dayAfter;
  return out;
}

/** One step of any write, in its caller-facing shape. */
function compactWriteResult(result) {
  return compactMealWrite(compactFoodUpdate(result));
}

/**
 * write_batch over MCP: every step compacted, and the day returned once (as it
 * stands after the whole batch) instead of once per meal step.
 */
function compactBatchResponse(result) {
  if (!result || result.error || !Array.isArray(result.results)) return result;
  let day = result.day ?? null;
  const results = result.results.map(step => {
    const { day: stepDay, ...rest } = compactWriteResult(step) || {};
    if (stepDay) day = stepDay;
    return rest;
  });
  const out = { ...result, results };
  if (day) out.day = day;
  return out;
}

module.exports = {
  OPS,
  compactFoodUpdate,
  compactWriteResult,
  compactBatchResponse,
  logMeal,
  addFoodItem,
  updateFoodItem,
  updateMealEntry,
  deleteMealEntry,
  updateSupplement,
  createMealPrep,
  logBodyWeight,
  setMaintenanceCalories,
  addDietPhase,
  updateDietPhase,
  deleteDietPhase,
  writeBatch,
  revertMcpWrite,
  listRecentMcpWrites,
  bulkDeleteMcpLogEntries,
  bulkDeleteMcpFoods,
  searchSimilarIngredients,
  recipeIngredientsSnapshotJson,
};
