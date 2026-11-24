/**
 * Training side of the "Download my data" export (GET /api/me/export) and of
 * the account delete (DELETE /api/me), so both always cover the same tables.
 * Every query is scoped by the caller's user id; soft-deleted rows are left out.
 * Sets and sessions have no soft delete, so they stay even when their exercise
 * was removed — they are the history the user logged.
 */
function exportGym(db, userId) {
  const all = (sql) => db.prepare(sql).all(userId);
  return {
    exercises: all('SELECT * FROM gym_exercises WHERE user_id = ? AND is_deleted = 0 ORDER BY id'),
    templates: all('SELECT * FROM gym_templates WHERE user_id = ? AND is_deleted = 0 ORDER BY id'),
    template_exercises: all(
      `SELECT te.* FROM gym_template_exercises te
         JOIN gym_templates t ON t.id = te.template_id AND t.user_id = te.user_id
        WHERE te.user_id = ? AND t.is_deleted = 0
        ORDER BY te.template_id, te.sort_order, te.id`
    ),
    schedule: all('SELECT * FROM gym_schedule WHERE user_id = ? ORDER BY weekday'),
    sessions: all('SELECT * FROM gym_sessions WHERE user_id = ? ORDER BY date, id'),
    sets: all('SELECT * FROM gym_sets WHERE user_id = ? ORDER BY session_id, set_index, id'),
    one_rep_maxes: all('SELECT * FROM gym_one_rep_maxes WHERE user_id = ? ORDER BY exercise_id'),
    legacy_workouts: {
      presets: all('SELECT * FROM workout_presets WHERE user_id = ? AND is_deleted = 0 ORDER BY id'),
      preset_exercises: all(
        `SELECT pe.* FROM workout_preset_exercises pe
           JOIN workout_presets p ON p.id = pe.preset_id AND p.user_id = pe.user_id
          WHERE pe.user_id = ? AND p.is_deleted = 0
          ORDER BY pe.preset_id, pe.sort_order, pe.id`
      ),
      exercise_logs: all('SELECT * FROM exercise_logs WHERE user_id = ? ORDER BY date, id'),
      day_selections: all('SELECT * FROM workout_day_selections WHERE user_id = ? ORDER BY date'),
      training_schedule: all('SELECT * FROM training_schedule WHERE user_id = ? ORDER BY weekday'),
      training_overrides: all('SELECT * FROM training_overrides WHERE user_id = ? ORDER BY date'),
      training_feedback: all('SELECT * FROM training_feedback WHERE user_id = ? ORDER BY date'),
      daily_context: all('SELECT * FROM daily_training_context WHERE user_id = ? ORDER BY date'),
      saved_recipes: all('SELECT * FROM training_saved_recipes WHERE user_id = ? ORDER BY recipe_id'),
    },
  };
}

/**
 * Account delete: flags the caller's training rows that have a soft-delete
 * column and returns their ids per table. The shared catalog (user_id = 0) is
 * never touched, since every update is scoped to the caller.
 */
function softDeleteGym(db, userId) {
  const flag = (table) => {
    const ids = db
      .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND is_deleted = 0 ORDER BY id`)
      .all(userId)
      .map(r => r.id);
    db.prepare(`UPDATE ${table} SET is_deleted = 1 WHERE user_id = ? AND is_deleted = 0`).run(userId);
    return ids;
  };
  return {
    gym_exercises: flag('gym_exercises'),
    gym_templates: flag('gym_templates'),
    workout_presets: flag('workout_presets'),
  };
}

module.exports = { exportGym, softDeleteGym };
