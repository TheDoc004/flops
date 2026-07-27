const Database = require('better-sqlite3');

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      serving_size TEXT NOT NULL,
      calories     REAL NOT NULL,
      protein_g    REAL NOT NULL,
      carbs_g      REAL NOT NULL,
      fat_g        REAL NOT NULL,
      fiber_g      REAL,
      ingredients  TEXT NOT NULL DEFAULT '[]',
      recipe_kind  TEXT NOT NULL DEFAULT 'permanent',
      remaining_uses INTEGER,
      max_uses     INTEGER,
      is_archived  INTEGER NOT NULL DEFAULT 0,
      meal_builder_meta TEXT,
      is_quick_food INTEGER NOT NULL DEFAULT 0,
      is_deleted  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS label_ingredients (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL DEFAULT 0,
      name                TEXT NOT NULL,
      base_label          TEXT,
      brand_name          TEXT,
      serving_size_text   TEXT NOT NULL,
      grams_per_serving   REAL,
      calories            REAL NOT NULL,
      protein_g           REAL NOT NULL,
      carbs_g             REAL NOT NULL,
      fat_g               REAL NOT NULL,
      fiber_g             REAL,
      photo_data_uri      TEXT,
      source_type         TEXT NOT NULL DEFAULT 'manual',
      use_count           INTEGER NOT NULL DEFAULT 0,
      last_used_at        TEXT
    );
    CREATE TABLE IF NOT EXISTS log_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id  INTEGER NOT NULL,
      date       TEXT NOT NULL,
      time_min   INTEGER,
      servings   REAL NOT NULL,
      notes      TEXT,
      recipe_name TEXT,
      serving_size TEXT,
      recipe_calories REAL,
      recipe_protein_g REAL,
      recipe_carbs_g REAL,
      recipe_fat_g REAL,
      recipe_fiber_g REAL,
      recipe_is_quick_food INTEGER,
      micros_json TEXT,
      ingredients_json TEXT,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );
    /* user_id: 0 = single-user placeholder until auth; use per-user ids later */
    CREATE TABLE IF NOT EXISTS day_goals (
      user_id   INTEGER NOT NULL DEFAULT 0,
      weekday   INTEGER NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      calories  REAL,
      protein_g REAL,
      carbs_g   REAL,
      fat_g     REAL,
      PRIMARY KEY (user_id, weekday)
    );
    CREATE TABLE IF NOT EXISTS day_goal_versions (
      user_id              INTEGER NOT NULL DEFAULT 0,
      effective_start_date TEXT NOT NULL,
      weekday              INTEGER NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      calories_min         REAL,
      calories_max         REAL,
      protein_g_min        REAL,
      protein_g_max        REAL,
      carbs_g_min          REAL,
      carbs_g_max          REAL,
      fat_g_min            REAL,
      fat_g_max            REAL,
      created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, effective_start_date, weekday)
    );
    CREATE TABLE IF NOT EXISTS user_profile (
      user_id               INTEGER NOT NULL DEFAULT 0,
      height_cm             REAL,
      weight_kg             REAL,
      age                   INTEGER,
      sex                   TEXT,
      goal_weight_kg        REAL,
      activity_level        TEXT,
      maintenance_calories  REAL,
      macro_units           TEXT DEFAULT 'metric',
      body_units            TEXT DEFAULT 'metric',
      dash_weight_chart_enabled INTEGER DEFAULT 1,
      dash_weight_days      INTEGER DEFAULT 30,
      dash_adherence_view   TEXT DEFAULT '7d',
      dash_supplements_enabled INTEGER DEFAULT 1,
      /* RETAINED, UNUSED: the three columns below belonged to the removed
         nutrition-training fuel features (archive/nutrition-training-integration).
         Kept because SQLite DROP COLUMN requires a table rebuild and the stored
         preferences may be useful when the bridge is rebuilt. Nothing reads or
         writes them from the UI. See docs/future/nutrition-training-bridge.md. */
      dash_training_fuel_enabled INTEGER DEFAULT 1,
      digestion_pref        TEXT DEFAULT 'none',
      training_goal         TEXT DEFAULT 'performance',
      PRIMARY KEY (user_id)
    );
    CREATE TABLE IF NOT EXISTS body_weights (
      user_id    INTEGER NOT NULL DEFAULT 0,
      date       TEXT NOT NULL,
      weight_kg  REAL NOT NULL,
      PRIMARY KEY (user_id, date)
    );

    /* Weekly recurring workout schedule (single-user v1) */
    CREATE TABLE IF NOT EXISTS training_schedule (
      user_id        INTEGER NOT NULL DEFAULT 0,
      weekday        INTEGER NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      enabled        INTEGER NOT NULL DEFAULT 0,
      time_min       INTEGER,
      workout_type   TEXT,
      duration_min   INTEGER,
      PRIMARY KEY (user_id, weekday)
    );

    /* One-off override for a specific calendar date */
    CREATE TABLE IF NOT EXISTS training_overrides (
      user_id        INTEGER NOT NULL DEFAULT 0,
      date           TEXT NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 1,
      time_min       INTEGER,
      workout_type   TEXT,
      duration_min   INTEGER,
      PRIMARY KEY (user_id, date)
    );

    /* RETAINED, UNUSED: saved go-to preworkout recipes (training→recipes FK).
       The endpoints and UI were removed with the nutrition-training separation
       (archive/nutrition-training-integration); the table and its data are kept
       so nothing is lost if the fuel bridge is rebuilt.
       See docs/future/nutrition-training-bridge.md. */
    CREATE TABLE IF NOT EXISTS training_saved_recipes (
      user_id      INTEGER NOT NULL DEFAULT 0,
      recipe_id    INTEGER NOT NULL,
      label        TEXT,
      PRIMARY KEY (user_id, recipe_id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    /* Lightweight post-workout feedback */
    CREATE TABLE IF NOT EXISTS training_feedback (
      user_id      INTEGER NOT NULL DEFAULT 0,
      date         TEXT NOT NULL,
      energy       TEXT,
      stomach      TEXT,
      performance  TEXT,
      notes        TEXT,
      PRIMARY KEY (user_id, date)
    );

    /* Per-calendar-day training intent (local date); not a recurring schedule */
    CREATE TABLE IF NOT EXISTS daily_training_context (
      user_id      INTEGER NOT NULL DEFAULT 0,
      date         TEXT NOT NULL,
      context_type TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );

    /* --- Lightweight Training (workouts) --- */
    CREATE TABLE IF NOT EXISTS workout_presets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL DEFAULT 0,
      name             TEXT NOT NULL,
      intensity_label  TEXT,
      notes            TEXT,
      is_deleted       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workout_preset_exercises (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL DEFAULT 0,
      preset_id    INTEGER NOT NULL,
      name         TEXT NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (preset_id) REFERENCES workout_presets(id)
    );

    /* Which workout preset was selected for a calendar date */
    CREATE TABLE IF NOT EXISTS workout_day_selections (
      user_id     INTEGER NOT NULL DEFAULT 0,
      date        TEXT NOT NULL,
      preset_id   INTEGER,
      preset_name TEXT,
      PRIMARY KEY (user_id, date)
    );

    /* Simple per-exercise daily log (single-line, not set-by-set) */
    CREATE TABLE IF NOT EXISTS exercise_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL DEFAULT 0,
      date           TEXT NOT NULL,
      preset_id      INTEGER,
      preset_name    TEXT,
      exercise_name  TEXT NOT NULL,
      weight         REAL,
      weight_unit    TEXT,
      reps           INTEGER,
      sets           INTEGER,
      created_at     TEXT NOT NULL
    );

    /* Structured exercise catalog — seeded by server, not user-editable yet.
       primary_muscle / secondary_muscles drive future nutrition-bridge recommendations. */
    CREATE TABLE IF NOT EXISTS exercise_library (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      primary_muscle     TEXT NOT NULL,
      secondary_muscles  TEXT NOT NULL DEFAULT '[]',
      movement_type      TEXT NOT NULL,
      equipment          TEXT NOT NULL
    );

    /* --- Supplement tracker (Nutrition) ---
       Definitions the user maintains; some carry macros, some are checklist-only.
       counts_toward_macros=1 means a taken dose feeds that day's macro totals. */
    CREATE TABLE IF NOT EXISTS supplements (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL DEFAULT 0,
      name                 TEXT NOT NULL,
      dose_text            TEXT,
      calories             REAL NOT NULL DEFAULT 0,
      protein_g            REAL NOT NULL DEFAULT 0,
      carbs_g              REAL NOT NULL DEFAULT 0,
      fat_g                REAL NOT NULL DEFAULT 0,
      counts_toward_macros INTEGER NOT NULL DEFAULT 0,
      micros_json          TEXT,
      sort_order           INTEGER NOT NULL DEFAULT 0,
      is_deleted           INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT DEFAULT CURRENT_TIMESTAMP
    );

    /* Per-calendar-day taken state for a supplement (local date) */
    CREATE TABLE IF NOT EXISTS supplement_log (
      user_id       INTEGER NOT NULL DEFAULT 0,
      date          TEXT NOT NULL,
      supplement_id INTEGER NOT NULL,
      taken         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date, supplement_id),
      FOREIGN KEY (supplement_id) REFERENCES supplements(id)
    );
  `);
  const recipeCols = db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name);
  if (!recipeCols.includes('ingredients')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'`);
  }
  if (recipeCols.length && !recipeCols.includes('recipe_kind')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN recipe_kind TEXT NOT NULL DEFAULT 'permanent'`);
  }
  if (recipeCols.length && !recipeCols.includes('remaining_uses')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN remaining_uses INTEGER`);
  }
  if (recipeCols.length && !recipeCols.includes('max_uses')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN max_uses INTEGER`);
  }
  if (recipeCols.length && !recipeCols.includes('is_archived')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);
  }
  if (recipeCols.length && !recipeCols.includes('meal_builder_meta')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN meal_builder_meta TEXT`);
  }
  if (recipeCols.length && !recipeCols.includes('is_quick_food')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN is_quick_food INTEGER NOT NULL DEFAULT 0`);
  }
  if (recipeCols.length && !recipeCols.includes('is_deleted')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`);
  }
  // Nullable (ALTER can't add a CURRENT_TIMESTAMP default): pre-existing rows
  // simply have no known age. New rows are stamped explicitly on insert.
  if (recipeCols.length && !recipeCols.includes('created_at')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN created_at TEXT`);
  }
  const logCols = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
  if (logCols.length && !logCols.includes('time_min')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN time_min INTEGER`);
  }
  if (logCols.length && !logCols.includes('recipe_name')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_name TEXT`);
  }
  if (logCols.length && !logCols.includes('serving_size')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN serving_size TEXT`);
  }
  if (logCols.length && !logCols.includes('recipe_calories')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_calories REAL`);
  }
  if (logCols.length && !logCols.includes('recipe_protein_g')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_protein_g REAL`);
  }
  if (logCols.length && !logCols.includes('recipe_carbs_g')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_carbs_g REAL`);
  }
  if (logCols.length && !logCols.includes('recipe_fat_g')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_fat_g REAL`);
  }
  if (logCols.length && !logCols.includes('recipe_fiber_g')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_fiber_g REAL`);
  }
  if (logCols.length && !logCols.includes('recipe_is_quick_food')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN recipe_is_quick_food INTEGER`);
  }
  if (logCols.length && !logCols.includes('slot_selections_json')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN slot_selections_json TEXT`);
  }
  if (logCols.length && !logCols.includes('micros_json')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN micros_json TEXT`);
  }
  // Phase 1: per-ingredient breakdown of what was actually logged (resolved
  // rows after substitutions/edits). Nullable; old rows stay null and display
  // as totals only.
  if (logCols.length && !logCols.includes('ingredients_json')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN ingredients_json TEXT`);
  }

  const goalVersionCols = db.prepare('PRAGMA table_info(day_goal_versions)').all().map(c => c.name);
  if (goalVersionCols.length && !goalVersionCols.includes('created_at')) {
    db.exec(`ALTER TABLE day_goal_versions ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  }
  const legacyGoalRows = db
    .prepare('SELECT user_id, weekday, calories, protein_g, carbs_g, fat_g FROM day_goals ORDER BY user_id, weekday')
    .all();
  if (legacyGoalRows.length > 0) {
    const migrateLegacyGoals = db.prepare(`
      INSERT INTO day_goal_versions (
        user_id, effective_start_date, weekday,
        calories_min, calories_max,
        protein_g_min, protein_g_max,
        carbs_g_min, carbs_g_max,
        fat_g_min, fat_g_max
      ) VALUES (?, '1970-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, effective_start_date, weekday) DO NOTHING
    `);
    const runMigration = db.transaction(rows => {
      for (const row of rows) {
        migrateLegacyGoals.run(
          row.user_id,
          row.weekday,
          row.calories,
          row.calories,
          row.protein_g,
          row.protein_g,
          row.carbs_g,
          row.carbs_g,
          row.fat_g,
          row.fat_g
        );
      }
    });
    runMigration(legacyGoalRows);
  }

  const labelCols = db.prepare('PRAGMA table_info(label_ingredients)').all().map(c => c.name);
  if (labelCols.length && !labelCols.includes('base_label')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN base_label TEXT`);
  }
  if (labelCols.length && !labelCols.includes('brand_name')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN brand_name TEXT`);
  }
  if (labelCols.length && !labelCols.includes('source_type')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'`);
  }
  if (labelCols.length && !labelCols.includes('use_count')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (labelCols.length && !labelCols.includes('last_used_at')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN last_used_at TEXT`);
  }
  if (labelCols.length && !labelCols.includes('tracking_type')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN tracking_type TEXT NOT NULL DEFAULT 'weight'`);
  }
  if (labelCols.length && !labelCols.includes('unit_name')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN unit_name TEXT`);
  }
  if (labelCols.length && !labelCols.includes('serving_quantity')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN serving_quantity REAL`);
  }
  if (labelCols.length && !labelCols.includes('grams_per_unit')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN grams_per_unit REAL`);
  }
  // Product barcode (EAN/UPC digits) when the ingredient came from a scan —
  // lets a re-scan find the saved item instead of adding a near-duplicate.
  if (labelCols.length && !labelCols.includes('barcode')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN barcode TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_label_ingredients_barcode ON label_ingredients (user_id, barcode)`);
  }
  const profileCols = db.prepare('PRAGMA table_info(user_profile)').all().map(c => c.name);
  if (profileCols.length && !profileCols.includes('macro_units')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN macro_units TEXT DEFAULT 'metric'`);
  }
  if (profileCols.length && !profileCols.includes('body_units')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN body_units TEXT`);
    db.exec(
      `UPDATE user_profile SET body_units = COALESCE(NULLIF(TRIM(macro_units), ''), 'metric')`
    );
  }
  if (profileCols.length && !profileCols.includes('dash_weight_chart_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_weight_chart_enabled INTEGER DEFAULT 1`);
  }
  if (profileCols.length && !profileCols.includes('dash_weight_days')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_weight_days INTEGER DEFAULT 30`);
  }
  if (profileCols.length && !profileCols.includes('dash_training_fuel_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_training_fuel_enabled INTEGER DEFAULT 1`);
  }
  if (profileCols.length && !profileCols.includes('digestion_pref')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN digestion_pref TEXT DEFAULT 'none'`);
  }
  if (profileCols.length && !profileCols.includes('training_goal')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN training_goal TEXT DEFAULT 'performance'`);
  }
  if (profileCols.length && !profileCols.includes('dash_adherence_view')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_adherence_view TEXT DEFAULT '7d'`);
  }
  if (profileCols.length && !profileCols.includes('dash_supplements_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_supplements_enabled INTEGER DEFAULT 1`);
  }

  // Supplements may predate micronutrient tracking — add the exact-micros column.
  const supplementCols = db.prepare('PRAGMA table_info(supplements)').all().map(c => c.name);
  if (supplementCols.length && !supplementCols.includes('micros_json')) {
    db.exec(`ALTER TABLE supplements ADD COLUMN micros_json TEXT`);
  }

  // Workout preset tables may already exist (noop if created above)
  // but keep here for older DBs created before this feature.
  const presetCols = db.prepare('PRAGMA table_info(workout_presets)').all().map(c => c.name);
  if (presetCols.length && !presetCols.includes('is_deleted')) {
    db.exec(`ALTER TABLE workout_presets ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`);
  }

  const scheduleCols = db.prepare('PRAGMA table_info(training_schedule)').all().map(c => c.name);
  if (scheduleCols.length && !scheduleCols.includes('preset_id')) {
    db.exec(`ALTER TABLE training_schedule ADD COLUMN preset_id INTEGER`);
  }

  const presetExCols = db.prepare('PRAGMA table_info(workout_preset_exercises)').all().map(c => c.name);
  if (presetExCols.length && !presetExCols.includes('exercise_library_id')) {
    db.exec(`ALTER TABLE workout_preset_exercises ADD COLUMN exercise_library_id INTEGER`);
  }

  // Seed exercise library if empty
  const libCount = db.prepare('SELECT COUNT(*) AS n FROM exercise_library').get().n;
  if (libCount === 0) {
    const insertExercise = db.prepare(
      `INSERT OR IGNORE INTO exercise_library (name, primary_muscle, secondary_muscles, movement_type, equipment)
       VALUES (?, ?, ?, ?, ?)`
    );
    const seedExercises = db.transaction(() => {
      const exercises = [
        // Push — Chest
        ['Barbell Bench Press',      'chest',      '["triceps","shoulders"]',       'push',   'barbell'],
        ['Incline Barbell Press',    'chest',      '["triceps","shoulders"]',       'push',   'barbell'],
        ['Dumbbell Bench Press',     'chest',      '["triceps","shoulders"]',       'push',   'dumbbell'],
        ['Incline Dumbbell Press',   'chest',      '["triceps","shoulders"]',       'push',   'dumbbell'],
        ['Dumbbell Chest Fly',       'chest',      '["shoulders"]',                 'push',   'dumbbell'],
        ['Cable Chest Fly',          'chest',      '["shoulders"]',                 'push',   'cable'],
        ['Push-up',                  'chest',      '["triceps","shoulders"]',       'push',   'bodyweight'],
        ['Machine Chest Press',      'chest',      '["triceps","shoulders"]',       'push',   'machine'],
        // Push — Shoulders
        ['Overhead Press',           'shoulders',  '["triceps"]',                   'push',   'barbell'],
        ['Dumbbell Shoulder Press',  'shoulders',  '["triceps"]',                   'push',   'dumbbell'],
        ['Lateral Raise',            'shoulders',  '[]',                            'push',   'dumbbell'],
        ['Front Raise',              'shoulders',  '[]',                            'push',   'dumbbell'],
        // Push — Triceps
        ['Tricep Pushdown',          'triceps',    '[]',                            'push',   'cable'],
        ['Skull Crusher',            'triceps',    '[]',                            'push',   'barbell'],
        ['Overhead Tricep Extension','triceps',    '[]',                            'push',   'dumbbell'],
        ['Dips',                     'triceps',    '["chest","shoulders"]',          'push',   'bodyweight'],
        // Pull — Back
        ['Deadlift',                 'back',       '["glutes","hamstrings"]',       'pull',   'barbell'],
        ['Barbell Row',              'back',       '["biceps"]',                    'pull',   'barbell'],
        ['Dumbbell Row',             'back',       '["biceps"]',                    'pull',   'dumbbell'],
        ['T-Bar Row',                'back',       '["biceps"]',                    'pull',   'barbell'],
        ['Lat Pulldown',             'back',       '["biceps"]',                    'pull',   'cable'],
        ['Seated Cable Row',         'back',       '["biceps"]',                    'pull',   'cable'],
        ['Pull-up',                  'back',       '["biceps"]',                    'pull',   'bodyweight'],
        ['Chin-up',                  'back',       '["biceps"]',                    'pull',   'bodyweight'],
        ['Face Pull',                'shoulders',  '["back"]',                      'pull',   'cable'],
        // Pull — Biceps
        ['Barbell Curl',             'biceps',     '["forearms"]',                  'pull',   'barbell'],
        ['Dumbbell Curl',            'biceps',     '["forearms"]',                  'pull',   'dumbbell'],
        ['Hammer Curl',              'biceps',     '["forearms"]',                  'pull',   'dumbbell'],
        ['Preacher Curl',            'biceps',     '[]',                            'pull',   'barbell'],
        ['Cable Curl',               'biceps',     '[]',                            'pull',   'cable'],
        // Legs — Quads
        ['Barbell Back Squat',       'quads',      '["glutes","hamstrings"]',       'legs',   'barbell'],
        ['Front Squat',              'quads',      '["glutes"]',                    'legs',   'barbell'],
        ['Goblet Squat',             'quads',      '["glutes"]',                    'legs',   'dumbbell'],
        ['Leg Press',                'quads',      '["glutes","hamstrings"]',       'legs',   'machine'],
        ['Leg Extension',            'quads',      '[]',                            'legs',   'machine'],
        ['Bulgarian Split Squat',    'quads',      '["glutes","hamstrings"]',       'legs',   'dumbbell'],
        ['Walking Lunge',            'quads',      '["glutes"]',                    'legs',   'dumbbell'],
        ['Step-up',                  'quads',      '["glutes"]',                    'legs',   'dumbbell'],
        // Legs — Posterior chain
        ['Romanian Deadlift',        'hamstrings', '["glutes","back"]',             'legs',   'barbell'],
        ['Leg Curl',                 'hamstrings', '[]',                            'legs',   'machine'],
        ['Hip Thrust',               'glutes',     '["hamstrings"]',                'legs',   'barbell'],
        ['Good Morning',             'hamstrings', '["back","glutes"]',             'legs',   'barbell'],
        // Legs — Calves
        ['Standing Calf Raise',      'calves',     '[]',                            'legs',   'machine'],
        ['Seated Calf Raise',        'calves',     '[]',                            'legs',   'machine'],
        // Core
        ['Plank',                    'core',       '[]',                            'core',   'bodyweight'],
        ['Crunch',                   'core',       '[]',                            'core',   'bodyweight'],
        ['Cable Crunch',             'core',       '[]',                            'core',   'cable'],
        ['Russian Twist',            'core',       '[]',                            'core',   'bodyweight'],
        ['Hanging Leg Raise',        'core',       '[]',                            'core',   'bodyweight'],
        ['Ab Wheel Rollout',         'core',       '[]',                            'core',   'bodyweight'],
        ['Dead Bug',                 'core',       '[]',                            'core',   'bodyweight'],
        // Cardio
        ['Treadmill Run',            'cardio',     '[]',                            'cardio', 'machine'],
        ['Jump Rope',                'cardio',     '[]',                            'cardio', 'bodyweight'],
        ['Rowing Machine',           'cardio',     '["back"]',                      'cardio', 'machine'],
        ['Cycling',                  'cardio',     '[]',                            'cardio', 'machine'],
      ];
      for (const row of exercises) insertExercise.run(...row);
    });
    seedExercises();
  }

  return db;
}

module.exports = { createDb };
