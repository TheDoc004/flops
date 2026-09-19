/**
 * Read-only data access for FLOPS MCP tools.
 * All queries are scoped to userId — never trust client-supplied user_id.
 */
const { MICRO_KEYS } = require('../microNutrients');
const { doseMultiplier, scaleValues } = require('../supplementDose');
const {
  isoDateOrNull,
  getLocalDateISO,
  isoWeekdayFromDate,
  normalizeRange,
} = require('./dates');

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

function sumMacros(entries) {
  return (entries || []).reduce((acc, e) => {
    const m = entryMacros(e);
    acc.calories += m.calories;
    acc.protein_g += m.protein_g;
    acc.carbs_g += m.carbs_g;
    acc.fat_g += m.fat_g;
    return acc;
  }, emptyMacros());
}

function addMacros(a, b) {
  return {
    calories: (a?.calories || 0) + (b?.calories || 0),
    protein_g: (a?.protein_g || 0) + (b?.protein_g || 0),
    carbs_g: (a?.carbs_g || 0) + (b?.carbs_g || 0),
    fat_g: (a?.fat_g || 0) + (b?.fat_g || 0),
  };
}

function shapeEntry(row) {
  const micros = parseMicrosBlob(row.micros_json);
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
    ingredients,
  };
}

function getLogEntries(db, userId, { date, start, end } = {}) {
  if (date) {
    return db
      .prepare(`${ENTRY_JOIN} WHERE le.user_id = ? AND le.date = ? ORDER BY le.id`)
      .all(userId, date)
      .map(shapeEntry);
  }
  return db
    .prepare(
      `${ENTRY_JOIN} WHERE le.user_id = ? AND le.date >= ? AND le.date <= ? ORDER BY le.date, le.id`
    )
    .all(userId, start, end)
    .map(shapeEntry);
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
        WHERE le.user_id = ? AND le.date >= ? AND le.date <= ?
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
  const entries = db
    .prepare(
      `SELECT servings, micros_json FROM log_entries
        WHERE user_id = ? AND date >= ? AND date <= ?`
    )
    .all(userId, start, end);
  const totals = {};
  let mealsWithMicros = 0;
  for (const e of entries) {
    const blob = parseMicrosBlob(e.micros_json);
    if (!blob?.micros) continue;
    mealsWithMicros += 1;
    accumulateMicros(totals, blob.micros, Number(e.servings) || 1);
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
  return {
    start,
    end,
    include_supplements: includeSupplements,
    meals_with_micros: mealsWithMicros,
    supplement_days_with_micros: supplementDays,
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
  getGymToday,
  getGymProgress,
  textResult,
  errorResult,
};
