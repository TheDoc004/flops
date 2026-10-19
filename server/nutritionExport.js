/**
 * Nutrition side of the "Download my data" export (GET /api/me/export).
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
  };
}

module.exports = { exportNutrition };
