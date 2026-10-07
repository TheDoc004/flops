/**
 * Read-only data access for FLOPS MCP tools.
 * All queries are scoped to userId — never trust client-supplied user_id.
 */
const { MICRO_KEYS } = require('../microNutrients');
const { basisUnitFor, loggableUnitsFor } = require('../unitConvert');
const { doseMultiplier, scaleValues } = require('../supplementDose');
const {
  isoDateOrNull,
  getLocalDateISO,
  isoWeekdayFromDate,
  normalizeRange,
} = require('./dates');
const {
  LB_PER_KG,
  kgToLb,
  linearTrendWithSe,
  confidenceLabel,
  round: trendRound,
} = require('./weightTrend');

const WEEKDAY_LABELS = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

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

/** Soft-deleted meals stay in the row but must never appear in day/history totals. */
const LOG_ALIVE = `COALESCE(le.is_deleted, 0) = 0`;
const LOG_ALIVE_BARE = `COALESCE(is_deleted, 0) = 0`;

function parseMicrosBlob(micros_json) {
  if (!micros_json) return null;
  try {
    const p = typeof micros_json === 'string' ? JSON.parse(micros_json) : micros_json;
    if (!p || typeof p !== 'object') return null;
    const src = p.micros && typeof p.micros === 'object' ? p.micros : p;
    const out = {};
    for (const k of MICRO_KEYS) {
      const v = Number(src[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
    if (!Object.keys(out).length) return null;
    return {
      micros: out,
      confidence: p.confidence || null,
      notes: p.notes || null,
    };
  } catch {
    return null;
  }
}

function emptyMacros() {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
}

function entryMacros(entry) {
  if (entry?.logged) {
    return {
      calories: Number(entry.logged.calories) || 0,
      protein_g: Number(entry.logged.protein_g) || 0,
      carbs_g: Number(entry.logged.carbs_g) || 0,
      fat_g: Number(entry.logged.fat_g) || 0,
    };
  }
  const s = Number(entry.servings) || 0;
  return {
    calories: (Number(entry.recipe_calories) || 0) * s,
    protein_g: (Number(entry.recipe_protein_g) || 0) * s,
    carbs_g: (Number(entry.recipe_carbs_g) || 0) * s,
    fat_g: (Number(entry.recipe_fat_g) || 0) * s,
  };
}

/**
 * Totals are sums of already-rounded entry values, so float noise is all that
 * extra precision carries ("184.82999999999998"). Round once, at the total.
 */
function roundMacroTotals(m) {
  const to = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
  return {
    calories: to(m.calories, 1),
    protein_g: to(m.protein_g, 2),
    carbs_g: to(m.carbs_g, 2),
    fat_g: to(m.fat_g, 2),
  };
}

function sumMacros(entries) {
  return roundMacroTotals((entries || []).reduce((acc, e) => {
    const m = entryMacros(e);
    acc.calories += m.calories;
    acc.protein_g += m.protein_g;
    acc.carbs_g += m.carbs_g;
    acc.fat_g += m.fat_g;
    return acc;
  }, emptyMacros()));
}

function addMacros(a, b) {
  return roundMacroTotals({
    calories: (a?.calories || 0) + (b?.calories || 0),
    protein_g: (a?.protein_g || 0) + (b?.protein_g || 0),
    carbs_g: (a?.carbs_g || 0) + (b?.carbs_g || 0),
    fat_g: (a?.fat_g || 0) + (b?.fat_g || 0),
  });
}

function shapeEntry(row, db = null, userId = null) {
  let micros = parseMicrosBlob(row.micros_json);
  let microsSource = micros ? 'frozen' : null;
  if (db && userId != null) {
    const { resolveEntryMicros } = require('../entryMicros');
    const resolved = resolveEntryMicros(db, userId, row);
    if (resolved.blob?.micros) {
      micros = {
        micros: resolved.blob.micros,
        confidence: resolved.blob.confidence || null,
        notes: resolved.blob.notes || null,
        missing_ingredients: resolved.blob.missing_ingredients || [],
      };
      microsSource = resolved.source;
    } else {
      micros = null;
      microsSource = null;
    }
  }
  let ingredients = null;
  if (row.ingredients_json) {
    try {
      const v = typeof row.ingredients_json === 'string'
        ? JSON.parse(row.ingredients_json)
        : row.ingredients_json;
      ingredients = Array.isArray(v) ? v : null;
    } catch {
      ingredients = null;
    }
  }
  const macros = entryMacros(row);
  return {
    id: row.id,
    date: row.date,
    time_min: row.time_min,
    servings: row.servings,
    notes: row.notes,
    recipe_id: row.recipe_id,
    recipe_name: row.recipe_name,
    serving_size: row.serving_size,
    is_quick_food: row.recipe_is_quick_food,
    source: row.source || 'app',
    weight_basis: row.weight_basis || null,
    nutrition_source: row.nutrition_source || null,
    per_serving: {
      calories: row.recipe_calories,
      protein_g: row.recipe_protein_g,
      carbs_g: row.recipe_carbs_g,
      fat_g: row.recipe_fat_g,
      fiber_g: row.recipe_fiber_g,
    },
    logged: macros,
    micros: micros?.micros || null,
    micros_confidence: micros?.confidence || null,
    micros_source: microsSource,
    // Ingredients whose micros are NOT in `micros` (no library data) — the
    // totals are a floor for these meals, not an exact sum.
    micros_missing_ingredients: micros?.missing_ingredients || [],
    ingredients,
  };
}

function getLogEntries(db, userId, { date, start, end } = {}) {
  if (date) {
    return db
      .prepare(`${ENTRY_JOIN} WHERE le.user_id = ? AND le.date = ? AND ${LOG_ALIVE} ORDER BY le.id`)
      .all(userId, date)
      .map(row => shapeEntry(row, db, userId));
  }
  return db
    .prepare(
      `${ENTRY_JOIN} WHERE le.user_id = ? AND le.date >= ? AND le.date <= ? AND ${LOG_ALIVE} ORDER BY le.date, le.id`
    )
    .all(userId, start, end)
    .map(row => shapeEntry(row, db, userId));
}

function getDailySummaries(db, userId, start, end) {
  return db
    .prepare(
      `SELECT le.date AS date,
              COUNT(*) AS entry_count,
              ROUND(SUM(le.servings * COALESCE(le.recipe_calories, r.calories, 0)), 1) AS calories,
              ROUND(SUM(le.servings * COALESCE(le.recipe_protein_g, r.protein_g, 0)), 2) AS protein_g,
              ROUND(SUM(le.servings * COALESCE(le.recipe_carbs_g, r.carbs_g, 0)), 2) AS carbs_g,
              ROUND(SUM(le.servings * COALESCE(le.recipe_fat_g, r.fat_g, 0)), 2) AS fat_g
         FROM log_entries le
         LEFT JOIN recipes r ON le.recipe_id = r.id
        WHERE le.user_id = ? AND le.date >= ? AND le.date <= ? AND ${LOG_ALIVE}
        GROUP BY le.date
        ORDER BY le.date`
    )
    .all(userId, start, end);
}

function emptyGoalRow(weekday) {
  return {
    weekday,
    label: WEEKDAY_LABELS[weekday],
    calories_min: null,
    calories_max: null,
    protein_g_min: null,
    protein_g_max: null,
    carbs_g_min: null,
    carbs_g_max: null,
    fat_g_min: null,
    fat_g_max: null,
  };
}

function getGoalsForDate(db, userId, date) {
  const resolved = isoDateOrNull(date) || getLocalDateISO();
  const effective = db
    .prepare(
      `SELECT effective_start_date FROM day_goal_versions
        WHERE user_id = ? AND effective_start_date <= ?
        ORDER BY effective_start_date DESC LIMIT 1`
    )
    .get(userId, resolved);
  const effective_start_date = effective?.effective_start_date || null;
  const rows = effective_start_date
    ? db
        .prepare(
          `SELECT weekday, calories_min, calories_max, protein_g_min, protein_g_max,
                  carbs_g_min, carbs_g_max, fat_g_min, fat_g_max
             FROM day_goal_versions
            WHERE user_id = ? AND effective_start_date = ?
            ORDER BY weekday ASC`
        )
        .all(userId, effective_start_date)
    : [];
  const byWd = new Map(rows.map(r => [r.weekday, r]));
  const goals = [1, 2, 3, 4, 5, 6, 7].map(wd => {
    const r = byWd.get(wd);
    if (!r) return emptyGoalRow(wd);
    return { ...emptyGoalRow(wd), ...r };
  });
  const weekday = isoWeekdayFromDate(resolved);
  const for_weekday = goals.find(g => g.weekday === weekday) || emptyGoalRow(weekday);
  return {
    resolved_for_date: resolved,
    effective_start_date,
    weekday,
    for_weekday,
    goals,
  };
}

function goalStatus(value, min, max) {
  if (max == null && min == null) return { status: 'no_goal', delta: null };
  const v = Number(value) || 0;
  const lo = min != null ? Number(min) : Number(max);
  const hi = max != null ? Number(max) : Number(min);
  if (Number.isFinite(hi) && v > hi) return { status: 'over', delta: Math.round((v - hi) * 10) / 10 };
  if (Number.isFinite(lo) && v < lo) return { status: 'below', delta: Math.round((lo - v) * 10) / 10 };
  return { status: 'in_range', delta: 0 };
}

function vsGoals(totals, goalRow) {
  if (!goalRow) return null;
  return {
    calories: goalStatus(totals.calories, goalRow.calories_min, goalRow.calories_max),
    protein_g: goalStatus(totals.protein_g, goalRow.protein_g_min, goalRow.protein_g_max),
    carbs_g: goalStatus(totals.carbs_g, goalRow.carbs_g_min, goalRow.carbs_g_max),
    fat_g: goalStatus(totals.fat_g, goalRow.fat_g_min, goalRow.fat_g_max),
  };
}

function shapeSupplement(row, dayDoseQty) {
  const labelMicros = parseMicrosBlob(row.micros_json)?.micros || null;
  const effectiveDose =
    Number.isFinite(Number(dayDoseQty)) && Number(dayDoseQty) > 0
      ? Number(dayDoseQty)
      : row.dose_qty;
  const multiplier = doseMultiplier({
    label_serving_qty: row.label_serving_qty,
    dose_qty: effectiveDose,
  });
  return {
    id: row.id,
    name: row.name,
    dose_text: row.dose_text || null,
    taken: row.taken != null ? Number(row.taken) : undefined,
    counts_toward_macros: Number(row.counts_toward_macros) === 1,
    dose_multiplier: Math.round(multiplier * 1000) / 1000,
    calories: Math.round((Number(row.calories) || 0) * multiplier * 100) / 100,
    protein_g: Math.round((Number(row.protein_g) || 0) * multiplier * 100) / 100,
    carbs_g: Math.round((Number(row.carbs_g) || 0) * multiplier * 100) / 100,
    fat_g: Math.round((Number(row.fat_g) || 0) * multiplier * 100) / 100,
    micros: labelMicros ? scaleValues(labelMicros, multiplier) : null,
  };
}

function getSupplementsForDate(db, userId, date) {
  const raw = db
    .prepare(
      `SELECT s.id, s.name, s.dose_text, s.calories, s.protein_g, s.carbs_g, s.fat_g,
              s.counts_toward_macros, s.micros_json, s.label_serving_qty, s.dose_qty,
              sl.dose_qty AS day_dose_qty,
              CASE WHEN sl.taken = 1 THEN 1 ELSE 0 END AS taken
         FROM supplements s
         LEFT JOIN supplement_log sl
           ON sl.supplement_id = s.id AND sl.user_id = s.user_id AND sl.date = ?
        WHERE s.user_id = ? AND COALESCE(s.is_deleted, 0) = 0
        ORDER BY s.sort_order, s.name`
    )
    .all(date, userId);
  const supplements = raw.map(({ day_dose_qty, ...row }) => shapeSupplement(row, day_dose_qty));
  const totals = supplements.reduce((acc, r) => {
    if (r.taken && r.counts_toward_macros) {
      acc.calories += r.calories;
      acc.protein_g += r.protein_g;
      acc.carbs_g += r.carbs_g;
      acc.fat_g += r.fat_g;
    }
    return acc;
  }, emptyMacros());
  return { date, supplements, totals };
}

function getSupplementsRange(db, userId, start, end) {
  const rows = db
    .prepare(
      `SELECT sl.date AS date, s.id AS id, s.name AS name, s.dose_text, s.micros_json,
              s.calories, s.protein_g, s.carbs_g, s.fat_g, s.counts_toward_macros,
              s.label_serving_qty, s.dose_qty, sl.dose_qty AS day_dose_qty
         FROM supplement_log sl
         JOIN supplements s ON s.id = sl.supplement_id AND s.user_id = sl.user_id
        WHERE sl.user_id = ? AND sl.taken = 1 AND sl.date >= ? AND sl.date <= ?
          AND (s.micros_json IS NOT NULL OR s.counts_toward_macros = 1)
        ORDER BY sl.date, s.sort_order, s.name`
    )
    .all(userId, start, end);
  const byDate = {};
  for (const r of rows) {
    const shaped = shapeSupplement(
      { ...r, taken: 1 },
      r.day_dose_qty
    );
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(shaped);
  }
  return { start, end, byDate };
}

function accumulateMicros(into, micros, scale = 1) {
  if (!micros) return;
  for (const k of MICRO_KEYS) {
    const v = Number(micros[k]);
    if (!Number.isFinite(v) || v <= 0) continue;
    into[k] = (into[k] || 0) + v * scale;
  }
}

function getMicronutrientTotals(db, userId, start, end, { includeSupplements = true } = {}) {
  const { resolveEntryMicros } = require('../entryMicros');
  const { MICRO_DAILY_TARGETS } = require('../microNutrients');

  const entries = db
    .prepare(
      `SELECT servings, micros_json, ingredients_json FROM log_entries
        WHERE user_id = ? AND date >= ? AND date <= ? AND ${LOG_ALIVE_BARE}`
    )
    .all(userId, start, end);
  const totals = {};
  let mealsWithMicros = 0;
  let mealsFromIngredients = 0;
  let mealsFromFrozen = 0;
  let ingredientRowsTotal = 0;
  let ingredientRowsCovered = 0;
  const missingIngredients = new Set();
  for (const e of entries) {
    const resolved = resolveEntryMicros(db, userId, e);
    if (!resolved.blob?.micros) continue;
    mealsWithMicros += 1;
    if (resolved.source === 'ingredients') mealsFromIngredients += 1;
    if (resolved.source === 'frozen') mealsFromFrozen += 1;
    ingredientRowsTotal += resolved.coverage.ingredient_rows;
    ingredientRowsCovered += resolved.coverage.covered;
    if (resolved.source === 'ingredients') {
      for (const name of resolved.coverage.missing_ingredients || []) missingIngredients.add(name);
    }
    accumulateMicros(totals, resolved.blob.micros, Number(e.servings) || 1);
  }
  let supplementDays = 0;
  if (includeSupplements) {
    const { byDate } = getSupplementsRange(db, userId, start, end);
    for (const list of Object.values(byDate)) {
      let any = false;
      for (const s of list) {
        if (s.micros) {
          accumulateMicros(totals, s.micros, 1);
          any = true;
        }
      }
      if (any) supplementDays += 1;
    }
  }
  // Round for readability
  const rounded = {};
  for (const [k, v] of Object.entries(totals)) {
    rounded[k] = Math.round(v * 1000) / 1000;
  }

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const dayCount =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, Math.round((endMs - startMs) / 86400000) + 1)
      : 1;

  const pct_of_daily_target = {};
  const avg_daily = {};
  for (const k of MICRO_KEYS) {
    const total = rounded[k] || 0;
    const avg = total / dayCount;
    avg_daily[k] = Math.round(avg * 1000) / 1000;
    const target = MICRO_DAILY_TARGETS[k];
    if (target > 0) {
      pct_of_daily_target[k] = Math.round((avg / target) * 1000) / 10; // one decimal %
    }
  }

  return {
    start,
    end,
    days: dayCount,
    include_supplements: includeSupplements,
    meals_total: entries.length,
    meals_with_micros: mealsWithMicros,
    meals_from_ingredients: mealsFromIngredients,
    meals_from_frozen: mealsFromFrozen,
    supplement_days_with_micros: supplementDays,
    coverage: {
      meals_with_micros: mealsWithMicros,
      meals_total: entries.length,
      meals_from_ingredients: mealsFromIngredients,
      meals_from_frozen: mealsFromFrozen,
      ingredient_rows_with_micros: ingredientRowsCovered,
      ingredient_rows_total: ingredientRowsTotal,
      // Logged foods counted as zero micros because their library entry has none.
      ingredients_missing_micros: [...missingIngredients].sort(),
    },
    daily_targets: { ...MICRO_DAILY_TARGETS },
    avg_daily,
    pct_of_daily_target,
    totals: rounded,
  };
}

function getBodyWeights(db, userId, start, end) {
  if (start && end) {
    return db
      .prepare(
        'SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date'
      )
      .all(userId, start, end);
  }
  return db
    .prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? ORDER BY date')
    .all(userId);
}

function getProfile(db, userId) {
  const row = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
  if (!row) {
    return {
      user_id: userId,
      height_cm: null,
      weight_kg: null,
      age: null,
      sex: null,
      goal_weight_kg: null,
      activity_level: null,
      maintenance_calories: null,
      macro_units: 'metric',
      body_units: 'metric',
    };
  }
  // Strip unused retained columns noise for agents
  const {
    dash_training_fuel_enabled,
    digestion_pref,
    training_goal,
    dash_layout_json,
    ...safe
  } = row;
  return safe;
}

function searchRecipes(db, userId, query, { limit = 25 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 25));
  const q = String(query || '').trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g,
              recipe_kind, remaining_uses, is_archived, is_quick_food
         FROM recipes
        WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 AND COALESCE(is_quick_food, 0) = 0
        ORDER BY name`
    )
    .all(userId);
  const filtered = q
    ? rows.filter(r => String(r.name || '').toLowerCase().includes(q))
    : rows;
  return filtered.slice(0, lim);
}

/**
 * Grams in ONE stored serving — the weight micros_per_100g scales by.
 * Weight-tracked rows store it as grams_per_serving; unit-tracked rows store
 * grams_per_unit (the weight of one unit_name), so a serving is
 * grams_per_unit × serving_quantity. grams_per_serving on a unit row is never
 * read: grams_per_unit is that row's only gram weight (same as unitConvert).
 */
function servingGramsFor(row) {
  if (!row) return null;
  if (row.tracking_type === 'unit') {
    // basisUnitFor also derives a volume unit's weight from grams_per_ml.
    const gpu = basisUnitFor(row)?.gramsPerUnit;
    if (!gpu) return null;
    const qty = Number(row.serving_quantity) > 0 ? Number(row.serving_quantity) : 1;
    return gpu * qty;
  }
  const gps = Number(row.grams_per_serving);
  return Number.isFinite(gps) && gps > 0 ? gps : null;
}

function per100FromServing(row) {
  // Tiny placeholders (e.g. 1g) are not real serving weights — treat as unknown.
  const { isUsableGramsPerServing } = require('../gramsPerServing');
  if (!isUsableGramsPerServing(row.grams_per_serving)) return null;
  const g = Number(row.grams_per_serving);
  const scale = 100 / g;
  return {
    calories: Math.round((Number(row.calories) || 0) * scale * 10) / 10,
    protein_g: Math.round((Number(row.protein_g) || 0) * scale * 100) / 100,
    carbs_g: Math.round((Number(row.carbs_g) || 0) * scale * 100) / 100,
    fat_g: Math.round((Number(row.fat_g) || 0) * scale * 100) / 100,
    fiber_g:
      row.fiber_g == null ? null : Math.round((Number(row.fiber_g) || 0) * scale * 100) / 100,
  };
}

/**
 * Search the ingredient library by name/brand substring.
 * Macros on the row are per label serving; per_100g is derived when grams_per_serving is set.
 */
function searchIngredients(db, userId, query, { limit = 25 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 25));
  const q = String(query || '').trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT ${INGREDIENT_COLUMNS}
         FROM label_ingredients
        WHERE user_id = ?
        ORDER BY use_count DESC, name COLLATE NOCASE`
    )
    .all(userId);
  if (!q) return rows.slice(0, lim).map(shapeIngredient);
  const ranked = [];
  rows.forEach(r => {
    const tier = matchTier(q, r.name, r.brand_name);
    if (tier != null) ranked.push({ r, tier });
  });
  // Stable sort: within a tier the use_count order from SQL holds.
  ranked.sort((a, b) => a.tier - b.tier);
  return ranked.slice(0, lim).map(({ r }) => shapeIngredient(r));
}

const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How well a lowercase query matches a library row, best first, or null for no
 * match: 0 the exact name, 1 a whole word ("apple" in "Pink Lady Apple"),
 * 2 the start of a word ("blueberr" in "Frozen blueberries"), 3 anywhere
 * ("apple" in "pineapple"). The brand counts the same as the name. Without the
 * tiers, use_count alone let four pineapple blends bury the actual apples.
 */
function matchTier(q, name, brand) {
  const fields = [String(name || '').toLowerCase(), String(brand || '').toLowerCase()];
  if (fields[0] === q) return 0;
  const esc = escapeRegex(q);
  const wholeWord = new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`);
  const wordStart = new RegExp(`(^|[^a-z0-9])${esc}`);
  if (fields.some(f => wholeWord.test(f))) return 1;
  if (fields.some(f => wordStart.test(f))) return 2;
  if (fields.some(f => f.includes(q))) return 3;
  return null;
}

/**
 * A whole container as a loggable amount: servings_per_container × one serving,
 * in grams (weight-tracked, or unit-tracked with grams_per_unit) and in units.
 */
function containerFor(r) {
  const spc = Number(r.servings_per_container);
  if (!Number.isFinite(spc) || spc <= 0) return null;
  const grams = servingGramsFor(r);
  const out = { servings: spc, grams: grams ? Math.round(grams * spc * 10) / 10 : null };
  if (r.tracking_type === 'unit') {
    const qty = Number(r.serving_quantity) > 0 ? Number(r.serving_quantity) : 1;
    out.quantity = Math.round(qty * spc * 1000) / 1000;
    out.unit = r.unit_name || 'unit';
  }
  return out;
}

/** One library row in the shape search_ingredients returns. */
function shapeIngredient(r) {
  const micros = parseMicrosBlob(r.micros_json);
  const gramsPerUnit = r.tracking_type === 'unit' ? basisUnitFor(r)?.gramsPerUnit : null;
  return {
    id: r.id,
    name: r.name,
    brand_name: r.brand_name || null,
    serving_size_text: r.serving_size_text,
    // Unit-tracked rows: derived from grams_per_unit (their only gram weight).
    grams_per_serving: servingGramsFor(r),
    ...(r.tracking_type === 'unit'
      ? {
          unit_name: r.unit_name || null,
          serving_quantity: r.serving_quantity ?? null,
          grams_per_unit: r.grams_per_unit ?? null,
          log_by: gramsPerUnit
            ? `count (quantity + unit "${r.unit_name || 'unit'}") or quantity_g`
            : `count only (quantity + unit "${r.unit_name || 'unit'}") — no grams_per_unit`,
        }
      : {}),
    grams_per_ml: r.grams_per_ml ?? null,
    // Every unit log_meal can take for this food (quantity + unit).
    loggable_units: loggableUnitsFor(r),
    weight_basis: r.weight_basis || null,
    nutrition_source: r.nutrition_source || null,
    source_type: r.source_type || null,
    tracking_type: r.tracking_type || null,
    barcode: r.barcode || null,
    created_via: r.created_via || 'app',
    per_serving: {
      calories: r.calories,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
      fiber_g: r.fiber_g,
    },
    per_100g: per100FromServing({ ...r, grams_per_serving: servingGramsFor(r) }),
    has_micros: !!(micros?.micros && Object.keys(micros.micros).length),
    micros_confidence: micros?.confidence || null,
    servings_per_container: r.servings_per_container ?? null,
    container: containerFor(r),
  };
}

const INGREDIENT_COLUMNS = `id, name, brand_name, serving_size_text, grams_per_serving,
              calories, protein_g, carbs_g, fat_g, fiber_g, micros_json,
              weight_basis, nutrition_source, source_type, tracking_type, created_via, barcode,
              unit_name, serving_quantity, grams_per_unit, servings_per_container, grams_per_ml`;

/**
 * One ingredient with its STORED micronutrients — the per-serving values every
 * meal containing it is summed from. Says which nutrients were estimated
 * (filled_keys) versus stored from a label or a deliberate write, and which
 * are absent, so an audit can find the row behind a suspicious meal total.
 */
function getIngredient(db, userId, id) {
  const row = db
    .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM label_ingredients WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  if (!row) return null;
  // Raw parse, not parseMicrosBlob: an audit needs stored zeros (a stored 0
  // blocks the gap-fill) and the blob's filled_keys / completed_at.
  let blob = null;
  try {
    const p = row.micros_json ? JSON.parse(row.micros_json) : null;
    if (p?.micros && typeof p.micros === 'object') blob = p;
  } catch { blob = null; }
  let perServing = null;
  if (blob) {
    perServing = {};
    for (const k of MICRO_KEYS) {
      const v = blob.micros[k];
      if (v != null && v !== '' && Number.isFinite(Number(v))) perServing[k] = Number(v);
    }
    if (!Object.keys(perServing).length) perServing = null;
  }
  const grams = servingGramsFor(row);
  let per100 = null;
  if (perServing && grams) {
    per100 = {};
    for (const [k, v] of Object.entries(perServing)) {
      per100[k] = Math.round((Number(v) * 100 / grams) * 1000) / 1000;
    }
  }
  const filled = Array.isArray(blob?.filled_keys) ? blob.filled_keys : [];
  return {
    ...shapeIngredient(row),
    micros: perServing
      ? {
          per_serving: perServing,
          per_100g: per100,
          confidence: blob.confidence || null,
          notes: blob.notes || null,
          estimated_keys: filled,
          stored_keys: Object.keys(perServing).filter(k => !filled.includes(k)),
          zero_keys: Object.keys(perServing).filter(k => perServing[k] === 0),
          absent_keys: MICRO_KEYS.filter(k => !(k in perServing)),
          completed_at: blob.completed_at || null,
        }
      : null,
  };
}

/**
 * Full supplement library (not just taken days).
 * Macros/micros are per label serving — same storage the dose multiplier scales at read time.
 */
function listSupplements(db, userId, { include_deleted = false } = {}) {
  const rows = db
    .prepare(
      `SELECT id, name, dose_text, label_serving_qty, label_serving_unit, dose_qty,
              calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json,
              sort_order, is_deleted, created_via
         FROM supplements
        WHERE user_id = ?
          AND (? = 1 OR COALESCE(is_deleted, 0) = 0)
        ORDER BY sort_order, name COLLATE NOCASE`
    )
    .all(userId, include_deleted ? 1 : 0);
  return rows.map(r => {
    const micros = parseMicrosBlob(r.micros_json)?.micros || null;
    const multiplier = doseMultiplier({
      label_serving_qty: r.label_serving_qty,
      dose_qty: r.dose_qty,
    });
    return {
      id: r.id,
      name: r.name,
      dose_text: r.dose_text || null,
      label_serving_qty: r.label_serving_qty,
      label_serving_unit: r.label_serving_unit || null,
      dose_qty: r.dose_qty,
      dose_multiplier: Math.round(multiplier * 1000) / 1000,
      counts_toward_macros: Number(r.counts_toward_macros) === 1,
      is_deleted: Number(r.is_deleted) === 1,
      created_via: r.created_via || 'app',
      per_label_serving: {
        calories: r.calories,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
        micros,
      },
    };
  });
}

function getGymToday(db, userId, date) {
  const d = isoDateOrNull(date) || getLocalDateISO();
  const weekday = isoWeekdayFromDate(d);
  const schedule = db
    .prepare(
      `SELECT * FROM gym_schedule WHERE user_id = ? AND weekday = ?`
    )
    .get(userId, weekday) || null;
  const session = db
    .prepare(
      `SELECT * FROM gym_sessions WHERE user_id = ? AND date = ?
        ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId, d) || null;
  let sets = [];
  if (session) {
    sets = db
      .prepare(
        `SELECT st.*, e.name AS exercise_name, e.primary_muscle
           FROM gym_sets st
           JOIN gym_exercises e ON e.id = st.exercise_id
          WHERE st.user_id = ? AND st.session_id = ?
          ORDER BY st.logged_at, st.id`
      )
      .all(userId, session.id);
  }
  let template = null;
  const templateId = session?.template_id || schedule?.template_id;
  if (templateId) {
    const t = db
      .prepare(
        `SELECT * FROM gym_templates WHERE id = ? AND user_id = ? AND is_deleted = 0`
      )
      .get(templateId, userId);
    if (t) {
      const exercises = db
        .prepare(
          `SELECT te.id, te.exercise_id, te.sort_order, te.target_sets, te.target_reps,
                  te.target_weight, te.rest_sec, te.notes, e.name, e.primary_muscle
             FROM gym_template_exercises te
             JOIN gym_exercises e ON e.id = te.exercise_id
            WHERE te.user_id = ? AND te.template_id = ?
            ORDER BY te.sort_order, te.id`
        )
        .all(userId, t.id);
      template = { ...t, exercises };
    }
  }
  return {
    date: d,
    weekday,
    schedule,
    session: session ? { ...session, sets } : null,
    template,
  };
}

function findExerciseId(db, userId, { exercise_id, exercise_name } = {}) {
  if (exercise_id) {
    const id = Number(exercise_id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'exercise_id must be a positive integer' };
    const row = db
      .prepare(
        `SELECT id, name FROM gym_exercises
          WHERE id = ? AND is_deleted = 0 AND (user_id = 0 OR user_id = ?)`
      )
      .get(id, userId);
    if (!row) return { error: `Exercise ${id} not found` };
    return { id: row.id, name: row.name };
  }
  const name = String(exercise_name || '').trim();
  if (!name) return { error: 'Provide exercise_id or exercise_name' };
  const row = db
    .prepare(
      `SELECT id, name FROM gym_exercises
        WHERE is_deleted = 0 AND (user_id = 0 OR user_id = ?)
          AND LOWER(name) LIKE ?
        ORDER BY CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END, name
        LIMIT 1`
    )
    .get(userId, `%${name.toLowerCase()}%`, name);
  if (!row) return { error: `No exercise matching "${name}"` };
  return { id: row.id, name: row.name };
}

function getGymProgress(db, userId, opts = {}) {
  const found = findExerciseId(db, userId, opts);
  if (found.error) return found;
  const today = isoDateOrNull(opts.today) || getLocalDateISO();
  const win = String(opts.window || 'ALL');
  const daysMap = { W: 7, '2W': 14, M: 30, '3M': 90, '6M': 180 };
  let from = isoDateOrNull(opts.from);
  let to = isoDateOrNull(opts.to);
  if (!from && daysMap[win]) {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - (daysMap[win] - 1));
    from = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  if (!to && win !== 'ALL') to = today;

  const clauses = ['st.user_id = ?', 'st.exercise_id = ?', 'COALESCE(st.is_warmup,0) = 0'];
  const params = [userId, found.id];
  if (from) {
    clauses.push('sess.date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('sess.date <= ?');
    params.push(to);
  }

  let rows = db
    .prepare(
      `SELECT sess.date, sess.id AS session_id, st.reps, st.weight, st.weight_unit, st.set_index
         FROM gym_sets st
         JOIN gym_sessions sess ON sess.id = st.session_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY sess.date ASC, st.set_index ASC, st.id ASC`
    )
    .all(...params);

  const lastN = opts.last_sessions != null ? Number(opts.last_sessions) : null;
  if (Number.isInteger(lastN) && lastN > 0) {
    const sessionIds = [...new Set(rows.map(r => r.session_id))];
    const keep = new Set(sessionIds.slice(-Math.min(50, lastN)));
    rows = rows.filter(r => keep.has(r.session_id));
  }

  const byDate = new Map();
  for (const r of rows) {
    const cur = byDate.get(r.date) || {
      date: r.date,
      sets: 0,
      reps: 0,
      volume: 0,
      top_weight: 0,
      top_reps: 0,
    };
    cur.sets += 1;
    cur.reps += Number(r.reps) || 0;
    cur.volume += (Number(r.weight) || 0) * (Number(r.reps) || 0);
    if ((Number(r.weight) || 0) > cur.top_weight) {
      cur.top_weight = Number(r.weight) || 0;
      cur.top_reps = Number(r.reps) || 0;
    }
    byDate.set(r.date, cur);
  }
  const daily = [...byDate.values()].map(d => ({
    ...d,
    lb_per_rep: d.reps ? d.volume / d.reps : 0,
  }));

  const oneRm = db
    .prepare('SELECT * FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?')
    .get(userId, found.id);

  return {
    exercise_id: found.id,
    exercise_name: found.name,
    from: from || null,
    to: to || null,
    window: win,
    sets: rows,
    daily,
    one_rm: oneRm || null,
  };
}

function getDay(db, userId, dateRaw) {
  const date = isoDateOrNull(dateRaw) || getLocalDateISO();
  const entries = getLogEntries(db, userId, { date });
  const mealTotals = sumMacros(entries);
  const supplements = getSupplementsForDate(db, userId, date);
  const combinedTotals = addMacros(mealTotals, supplements.totals);
  const goals = getGoalsForDate(db, userId, date);
  const weight = db
    .prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date = ?')
    .get(userId, date);
  return {
    date,
    meals: entries,
    meal_totals: mealTotals,
    supplements: supplements.supplements,
    supplement_macro_totals: supplements.totals,
    combined_totals: combinedTotals,
    goals: goals.for_weekday,
    vs_goals: vsGoals(combinedTotals, goals.for_weekday),
    body_weight_kg: weight?.weight_kg ?? null,
  };
}

function filterBySegment(rows, start, end, { exclusiveEnd = false } = {}) {
  return (rows || []).filter(r => {
    if (!r?.date) return false;
    if (r.date < start) return false;
    if (exclusiveEnd) return r.date < end;
    return r.date <= end;
  });
}

function summarizeIntakeWeightSegment(summaries, weights, { start, end, energyDensity }) {
  const daysInRange = (() => {
    const a = new Date(`${start}T12:00:00`);
    const b = new Date(`${end}T12:00:00`);
    return Math.floor((b - a) / 86400000) + 1;
  })();

  const logged = summaries || [];
  const daysWithFoodLog = logged.length;
  let sumCal = 0;
  let sumP = 0;
  let sumC = 0;
  let sumF = 0;
  for (const d of logged) {
    sumCal += Number(d.calories) || 0;
    sumP += Number(d.protein_g) || 0;
    sumC += Number(d.carbs_g) || 0;
    sumF += Number(d.fat_g) || 0;
  }
  const avgCalories = daysWithFoodLog ? sumCal / daysWithFoodLog : null;
  const avgProteinG = daysWithFoodLog ? sumP / daysWithFoodLog : null;
  const avgCarbsG = daysWithFoodLog ? sumC / daysWithFoodLog : null;
  const avgFatG = daysWithFoodLog ? sumF / daysWithFoodLog : null;

  const weighIns = weights || [];
  const weighInCount = weighIns.length;
  let avgKg = null;
  let avgLb = null;
  if (weighInCount) {
    const sumKg = weighIns.reduce((s, w) => s + (Number(w.weight_kg) || 0), 0);
    avgKg = sumKg / weighInCount;
    avgLb = kgToLb(avgKg);
  }

  const pointsLb = weighIns.map(w => ({ date: w.date, value: kgToLb(w.weight_kg) }));
  const trend = linearTrendWithSe(pointsLb);
  let slopeLbPerWeek = null;
  let slopeSeLbPerWeek = null;
  if (trend) {
    slopeLbPerWeek = trend.slopePerDay * 7;
    slopeSeLbPerWeek =
      trend.slopeSePerDay != null ? trend.slopeSePerDay * 7 : null;
  }

  const conf = confidenceLabel(weighInCount, slopeLbPerWeek, slopeSeLbPerWeek);

  let estimatedMaintenance = null;
  if (avgCalories != null && slopeLbPerWeek != null) {
    estimatedMaintenance = avgCalories - (slopeLbPerWeek * energyDensity) / 7;
  }

  return {
    start,
    end,
    days_in_range: daysInRange,
    days_with_food_log: daysWithFoodLog,
    weigh_in_count: weighInCount,
    avg_daily_calories: trendRound(avgCalories, 1),
    avg_daily_protein_g: trendRound(avgProteinG, 1),
    avg_daily_carbs_g: trendRound(avgCarbsG, 1),
    avg_daily_fat_g: trendRound(avgFatG, 1),
    avg_weight_kg: trendRound(avgKg, 2),
    avg_weight_lb: trendRound(avgLb, 2),
    slope_lb_per_week: trendRound(slopeLbPerWeek, 3),
    slope_se_lb_per_week: trendRound(slopeSeLbPerWeek, 3),
    confidence: conf.confidence,
    confidence_reason: conf.reason,
    estimated_maintenance_kcal: trendRound(estimatedMaintenance, 0),
    estimated_maintenance_note:
      'Inference, not a measurement. Uses avg intake − (slope_lb/week × energy_density / 7). '
      + `energy_density defaults to ${energyDensity} kcal/lb (≈fat tissue); mixed lean/fat gain differs.`,
  };
}

/**
 * Intake vs weight trend over a window, optional split into baseline/current.
 */
function getIntakeWeightTrend(
  db,
  userId,
  { start, end, split_at, energy_density_cal_per_lb } = {}
) {
  const range = normalizeRange(start, end, { maxDays: 90 });
  if (range.error) return { error: range.error };

  const energyDensity =
    energy_density_cal_per_lb != null && Number.isFinite(Number(energy_density_cal_per_lb))
      ? Number(energy_density_cal_per_lb)
      : 3500;
  if (energyDensity <= 0) {
    return { error: 'energy_density_cal_per_lb must be a positive number' };
  }

  const splitAt = split_at ? isoDateOrNull(split_at) : null;
  if (split_at && !splitAt) {
    return { error: 'split_at must be YYYY-MM-DD' };
  }
  if (splitAt && (splitAt < range.start || splitAt > range.end)) {
    return { error: 'split_at must fall within start..end' };
  }

  const allSummaries = getDailySummaries(db, userId, range.start, range.end);
  const allWeights = getBodyWeights(db, userId, range.start, range.end);
  const profile = getProfile(db, userId);

  const meta = {
    start: range.start,
    end: range.end,
    energy_density_cal_per_lb: energyDensity,
    body_units: profile.body_units || 'metric',
    lb_per_kg: LB_PER_KG,
  };

  if (!splitAt) {
    const segment = summarizeIntakeWeightSegment(allSummaries, allWeights, {
      start: range.start,
      end: range.end,
      energyDensity,
    });
    return { ...meta, split_at: null, window: segment };
  }

  // Baseline: start → split_at exclusive; current: split_at → end inclusive.
  const baselineEndExclusive = splitAt;
  const baselineLastDay = (() => {
    const d = new Date(`${splitAt}T12:00:00`);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  if (baselineLastDay < range.start) {
    return { error: 'split_at leaves an empty baseline segment' };
  }

  const baselineSummaries = filterBySegment(allSummaries, range.start, baselineEndExclusive, {
    exclusiveEnd: true,
  });
  const baselineWeights = filterBySegment(allWeights, range.start, baselineEndExclusive, {
    exclusiveEnd: true,
  });
  const currentSummaries = filterBySegment(allSummaries, splitAt, range.end);
  const currentWeights = filterBySegment(allWeights, splitAt, range.end);

  const baseline = summarizeIntakeWeightSegment(baselineSummaries, baselineWeights, {
    start: range.start,
    end: baselineLastDay,
    energyDensity,
  });
  const current = summarizeIntakeWeightSegment(currentSummaries, currentWeights, {
    start: splitAt,
    end: range.end,
    energyDensity,
  });

  const delta = {
    avg_daily_calories: trendRound(
      (current.avg_daily_calories ?? 0) - (baseline.avg_daily_calories ?? 0),
      1
    ),
    avg_weight_lb: trendRound(
      (current.avg_weight_lb ?? 0) - (baseline.avg_weight_lb ?? 0),
      2
    ),
    avg_weight_kg: trendRound(
      (current.avg_weight_kg ?? 0) - (baseline.avg_weight_kg ?? 0),
      2
    ),
    slope_lb_per_week: trendRound(
      (current.slope_lb_per_week ?? 0) - (baseline.slope_lb_per_week ?? 0),
      3
    ),
  };

  return {
    ...meta,
    split_at: splitAt,
    baseline,
    current,
    delta,
  };
}

function textResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

module.exports = {
  servingGramsFor,
  normalizeRange,
  isoDateOrNull,
  getLocalDateISO,
  getDay,
  getLogEntries,
  getDailySummaries,
  getGoalsForDate,
  getBodyWeights,
  getProfile,
  getSupplementsForDate,
  getSupplementsRange,
  getMicronutrientTotals,
  searchRecipes,
  searchIngredients,
  getIngredient,
  listSupplements,
  getGymToday,
  getGymProgress,
  getIntakeWeightTrend,
  textResult,
  errorResult,
};
