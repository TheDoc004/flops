/**
 * Training side of the "Download my data" export (GET /api/me/export).
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
    },
  };
}

module.exports = { exportGym };
