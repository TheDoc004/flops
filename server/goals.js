/**
 * Versioned weekly macro goals — storage + resolution, shared by /api/goals
 * and the MCP update_goals tool so both write the exact same rows.
 *
 * A version is 7 rows (ISO weekday Mon=1…Sun=7) sharing an effective_start_date.
 * The goals for a date come from the latest version starting on or before it,
 * so a new version changes that day forward and leaves earlier days alone.
 */

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

const ROW_COLUMNS = `weekday,
           calories_min, calories_max,
           protein_g_min, protein_g_max,
           carbs_g_min, carbs_g_max,
           fat_g_min, fat_g_max`;

function normalizeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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

/** effective_start_date of the version in force on `date`, or null. */
function resolveEffectiveStartDate(db, userId, date) {
  const row = db
    .prepare(
      `SELECT effective_start_date
         FROM day_goal_versions
        WHERE user_id = ? AND effective_start_date <= ?
        ORDER BY effective_start_date DESC
        LIMIT 1`
    )
    .get(userId, date);
  return row?.effective_start_date || null;
}

/** First version starting strictly after `date`, or null. */
function nextEffectiveStartDate(db, userId, date) {
  const row = db
    .prepare(
      `SELECT MIN(effective_start_date) AS d
         FROM day_goal_versions
        WHERE user_id = ? AND effective_start_date > ?`
    )
    .get(userId, date);
  return row?.d || null;
}

/** Raw stored rows of one version (empty array if no version starts that day). */
function listRowsForVersion(db, userId, effectiveStartDate) {
  return db
    .prepare(
      `SELECT ${ROW_COLUMNS}
         FROM day_goal_versions
        WHERE user_id = ? AND effective_start_date = ?
        ORDER BY weekday ASC`
    )
    .all(userId, effectiveStartDate);
}

function listVersions(db, userId) {
  const rows = db
    .prepare(
      `SELECT effective_start_date, ${ROW_COLUMNS}
         FROM day_goal_versions
        WHERE user_id = ?
        ORDER BY effective_start_date ASC, weekday ASC`
    )
    .all(userId);
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

/** The 7 goal rows in force on `date` (all-null rows when no version applies). */
function goalsForDate(db, userId, date) {
  const effective_start_date = resolveEffectiveStartDate(db, userId, date);
  const rows = effective_start_date ? listRowsForVersion(db, userId, effective_start_date) : [];
  return { effective_start_date, goals: buildGoalRowsFromDbRows(rows) };
}

/**
 * Write rows (already normalized: weekday + *_min/*_max) as the version starting
 * `effectiveStartDate`. A version already starting that day is overwritten per
 * weekday — the same thing saving twice in one day does in the app.
 */
function upsertVersionRows(db, userId, effectiveStartDate, rows, source = 'app') {
  const stmt = db.prepare(`
    INSERT INTO day_goal_versions (
      user_id, effective_start_date, weekday,
      calories_min, calories_max,
      protein_g_min, protein_g_max,
      carbs_g_min, carbs_g_max,
      fat_g_min, fat_g_max,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, effective_start_date, weekday) DO UPDATE SET
      calories_min = excluded.calories_min,
      calories_max = excluded.calories_max,
      protein_g_min = excluded.protein_g_min,
      protein_g_max = excluded.protein_g_max,
      carbs_g_min = excluded.carbs_g_min,
      carbs_g_max = excluded.carbs_g_max,
      fat_g_min = excluded.fat_g_min,
      fat_g_max = excluded.fat_g_max,
      source = excluded.source
  `);
  for (const row of rows) {
    stmt.run(
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
      row.fat_g_max,
      source
    );
  }
}

/** Who wrote a version ('app' | 'mcp'), or null when no version starts that day. */
function versionSource(db, userId, effectiveStartDate) {
  const row = db
    .prepare('SELECT source FROM day_goal_versions WHERE user_id = ? AND effective_start_date = ? LIMIT 1')
    .get(userId, effectiveStartDate);
  return row?.source || null;
}

/** Remove one version's rows entirely. Only used to undo an MCP-created version. */
function deleteVersion(db, userId, effectiveStartDate) {
  db.prepare('DELETE FROM day_goal_versions WHERE user_id = ? AND effective_start_date = ?')
    .run(userId, effectiveStartDate);
}

module.exports = {
  WEEKDAY_RANGE,
  WEEKDAY_LABELS,
  GOAL_FIELDS,
  emptyGoalRow,
  normalizeRangePair,
  buildGoalRowsFromDbRows,
  resolveEffectiveStartDate,
  nextEffectiveStartDate,
  listRowsForVersion,
  listVersions,
  goalsForDate,
  upsertVersionRows,
  versionSource,
  deleteVersion,
};
