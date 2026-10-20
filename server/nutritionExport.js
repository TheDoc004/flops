/**
 * Nutrition side of the "Download my data" export (GET /api/me/export) and of
 * the account delete (DELETE /api/me), so both always cover the same tables.
 * Every query is scoped by the caller's user id; soft-deleted rows are left out.
 */
function exportNutrition(db, userId) {
  const all = (sql) => db.prepare(sql).all(userId);
  return {
    profile: db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId) || null,
    goals: {
      versions: all(
        'SELECT * FROM day_goal_versions WHERE user_id = ? ORDER BY effective_start_date, weekday'
      ),
      legacy_day_goals: all('SELECT * FROM day_goals WHERE user_id = ? ORDER BY weekday'),
    },
    log_entries: all(
      'SELECT * FROM log_entries WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY date, id'
    ),
    recipes: all('SELECT * FROM recipes WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY id'),
    // Ingredient deletes are hard deletes, so every remaining row is live.
    ingredients: all('SELECT * FROM label_ingredients WHERE user_id = ? ORDER BY id'),
    supplements: all(
      'SELECT * FROM supplements WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY sort_order, id'
    ),
    supplement_checks: all(
      `SELECT sl.* FROM supplement_log sl
         JOIN supplements s ON s.id = sl.supplement_id AND s.user_id = sl.user_id
        WHERE sl.user_id = ? AND COALESCE(s.is_deleted, 0) = 0
        ORDER BY sl.date, sl.supplement_id`
    ),
    body_weights: all('SELECT * FROM body_weights WHERE user_id = ? ORDER BY date'),
    diet_phases: all(
      'SELECT * FROM diet_phases WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY start_date, id'
    ),
    // 'dismissed' is the prep list's soft delete.
    prep_items: all(
      `SELECT * FROM day_prep_items WHERE user_id = ? AND status != 'dismissed' ORDER BY date, sort_order, id`
    ),
    // Depleted batches are used up, not deleted: they stay as history.
    prepped_batches: all('SELECT * FROM prepped_batches WHERE user_id = ? ORDER BY id'),
  };
}

/**
 * Account delete: flags the caller's nutrition rows that have a soft-delete
 * column and returns their ids per table. Tables without one are left as they
 * are; the deleted account can no longer reach them.
 */
function softDeleteNutrition(db, userId) {
  const flag = (table, liveWhere, setSql) => {
    const ids = db
      .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND ${liveWhere} ORDER BY id`)
      .all(userId)
      .map(r => r.id);
    db.prepare(`UPDATE ${table} SET ${setSql} WHERE user_id = ? AND ${liveWhere}`).run(userId);
    return ids;
  };
  const live = 'COALESCE(is_deleted, 0) = 0';
  return {
    log_entries: flag('log_entries', live, 'is_deleted = 1'),
    recipes: flag('recipes', live, 'is_deleted = 1'),
    supplements: flag('supplements', live, 'is_deleted = 1'),
    diet_phases: flag('diet_phases', live, "is_deleted = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"),
    day_prep_items: flag('day_prep_items', "status != 'dismissed'", "status = 'dismissed'"),
  };
}

module.exports = { exportNutrition, softDeleteNutrition };
