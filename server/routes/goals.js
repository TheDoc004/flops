const express = require('express');

/** ISO weekday: Monday = 1 … Sunday = 7 */
const WEEKDAY_RANGE = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_LABELS = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const GOAL_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

function normalizeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeIsoDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getLocalDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function normalizeRangePair(goalRow, key) {
  const rawMin = goalRow?.[`${key}_min`];
  const rawMax = goalRow?.[`${key}_max`];
  const rawLegacy = goalRow?.[key];

  let min = normalizeNumber(rawMin);
  let max = normalizeNumber(rawMax);

  if (rawMin === undefined && rawMax === undefined && rawLegacy !== undefined) {
    const exact = normalizeNumber(rawLegacy);
    min = exact;
    max = exact;
  }

  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;
  if (min != null && max != null && min > max) {
    const err = new Error(`${key}_min must be less than or equal to ${key}_max`);
    err.code = 'INVALID_RANGE';
    throw err;
  }
  return { min, max };
}

function buildGoalRowsFromDbRows(rows) {
  const byDay = Object.fromEntries(rows.map(r => [r.weekday, r]));
  return WEEKDAY_RANGE.map(weekday => ({
    ...emptyGoalRow(weekday),
    calories_min: byDay[weekday]?.calories_min ?? null,
    calories_max: byDay[weekday]?.calories_max ?? null,
    protein_g_min: byDay[weekday]?.protein_g_min ?? null,
    protein_g_max: byDay[weekday]?.protein_g_max ?? null,
    carbs_g_min: byDay[weekday]?.carbs_g_min ?? null,
    carbs_g_max: byDay[weekday]?.carbs_g_max ?? null,
    fat_g_min: byDay[weekday]?.fat_g_min ?? null,
    fat_g_max: byDay[weekday]?.fat_g_max ?? null,
  }));
}

function createGoalsRouter(db) {
  const router = express.Router();

  const listVersionRows = db.prepare(`
    SELECT effective_start_date, weekday,
           calories_min, calories_max,
           protein_g_min, protein_g_max,
           carbs_g_min, carbs_g_max,
           fat_g_min, fat_g_max
      FROM day_goal_versions
     WHERE user_id = ?
     ORDER BY effective_start_date ASC, weekday ASC
  `);

  const resolveEffectiveDate = db.prepare(`
    SELECT effective_start_date
      FROM day_goal_versions
     WHERE user_id = ? AND effective_start_date <= ?
     ORDER BY effective_start_date DESC
     LIMIT 1
  `);

  const listRowsForVersion = db.prepare(`
    SELECT weekday,
           calories_min, calories_max,
           protein_g_min, protein_g_max,
           carbs_g_min, carbs_g_max,
           fat_g_min, fat_g_max
      FROM day_goal_versions
     WHERE user_id = ? AND effective_start_date = ?
     ORDER BY weekday ASC
  `);

  const upsert = db.prepare(`
    INSERT INTO day_goal_versions (
      user_id, effective_start_date, weekday,
      calories_min, calories_max,
      protein_g_min, protein_g_max,
      carbs_g_min, carbs_g_max,
      fat_g_min, fat_g_max
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, effective_start_date, weekday) DO UPDATE SET
      calories_min = excluded.calories_min,
      calories_max = excluded.calories_max,
      protein_g_min = excluded.protein_g_min,
      protein_g_max = excluded.protein_g_max,
      carbs_g_min = excluded.carbs_g_min,
      carbs_g_max = excluded.carbs_g_max,
      fat_g_min = excluded.fat_g_min,
      fat_g_max = excluded.fat_g_max
  `);

  function buildVersions(userId) {
    const rows = listVersionRows.all(userId);
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.effective_start_date)) grouped.set(row.effective_start_date, []);
      grouped.get(row.effective_start_date).push(row);
    }
    return [...grouped.entries()].map(([effective_start_date, versionRows]) => ({
      effective_start_date,
      goals: buildGoalRowsFromDbRows(versionRows),
    }));
  }

  function buildPayload(userId, resolvedForDate = getLocalDateISO()) {
    const effectiveRow = resolveEffectiveDate.get(userId, resolvedForDate);
    const effective_start_date = effectiveRow?.effective_start_date || null;
    const currentRows = effective_start_date ? listRowsForVersion.all(userId, effective_start_date) : [];
    return {
      user_id: userId,
      resolved_for_date: resolvedForDate,
      effective_start_date,
      goals: buildGoalRowsFromDbRows(currentRows),
      versions: buildVersions(userId),
    };
  }

  router.get('/', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const date = normalizeIsoDate(req.query.date) || getLocalDateISO();
    res.json(buildPayload(userId, date));
  });

  router.put('/', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const effectiveStartDate = normalizeIsoDate(req.body?.effective_start_date) || getLocalDateISO();
    const { goals } = req.body;
    if (!Array.isArray(goals)) {
      return res.status(400).json({ error: 'Body must include goals: array' });
    }

    const normalized = [];
    const seen = new Set();
    try {
      for (const g of goals) {
        const wd = Number(g?.weekday);
        if (!Number.isInteger(wd) || wd < 1 || wd > 7) {
          return res.status(400).json({ error: 'Each goal needs weekday 1–7 (Mon–Sun)' });
        }
        if (seen.has(wd)) {
          return res.status(400).json({ error: `Duplicate weekday ${wd}` });
        }
        seen.add(wd);

        const row = { weekday: wd };
        for (const key of GOAL_FIELDS) {
          const pair = normalizeRangePair(g, key);
          row[`${key}_min`] = pair.min;
          row[`${key}_max`] = pair.max;
        }
        normalized.push(row);
      }
    } catch (e) {
      if (e.code === 'INVALID_RANGE') {
        return res.status(400).json({ error: e.message });
      }
      throw e;
    }

    db.transaction(() => {
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
    })();

    res.json(buildPayload(userId, effectiveStartDate));
  });

  return router;
}

module.exports = { createGoalsRouter };
