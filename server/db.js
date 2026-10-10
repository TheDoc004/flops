const Database = require('better-sqlite3');
const { parseServingText } = require('./supplementDose');

/**
 * Repairs ingredients that say they are measured by weight but carry no grams
 * per serving, while their unit fields describe a perfectly good serving
 * ("1 serving", "1 scoop"). Those rows are HYBRIDS: the write path defaults
 * tracking_type to 'weight' whenever a client omits it, so an ingredient saved
 * with a unit-shaped serving lands as weight-tracked with nothing to scale by,
 * and then cannot be logged at all — "needs grams per serving before it can be
 * logged", on an ingredient whose serving is right there in the row.
 *
 * Flipping them to 'unit' is safe because such a row is currently unloggable:
 * every scaling path returns null for it, so there is no working behaviour to
 * preserve, and the unit fields are the only description of a serving it has.
 * Rows with no unit information are genuinely incomplete and are left alone for
 * the user to fix. Idempotent.
 */
/**
 * Placeholder grams_per_serving = 1 (or other < 3g) blew up MCP per_100g derivation.
 * Diego's library: null cosmetic gps on unit-tracked ids; flip weight-tracked
 * rice cakes / bagel (eaten by piece) to unit + null gps. Idempotent. No invented weights.
 */
function repairPlaceholderGramsPerServing(db) {
  const nullUnitCosmetic = db
    .prepare(
      `UPDATE label_ingredients
          SET grams_per_serving = NULL
        WHERE id IN (13, 27, 28, 29, 31)
          AND grams_per_serving IS NOT NULL
          AND grams_per_serving > 0
          AND grams_per_serving < 3`
    )
    .run();

  const flipIds = [11, 22, 34];
  const get = db.prepare(
    `SELECT id, tracking_type, grams_per_serving, unit_name, serving_quantity
       FROM label_ingredients WHERE id = ?`
  );
  const upd = db.prepare(
    `UPDATE label_ingredients
        SET tracking_type = 'unit',
            grams_per_serving = NULL,
            unit_name = ?,
            serving_quantity = ?
      WHERE id = ?`
  );
  let flipped = 0;
  const run = db.transaction(() => {
    for (const id of flipIds) {
      const row = get.get(id);
      if (!row) continue;
      const gps = Number(row.grams_per_serving);
      const stillPlaceholder =
        row.tracking_type === 'weight' ||
        (Number.isFinite(gps) && gps > 0 && gps < 3);
      if (!stillPlaceholder && row.grams_per_serving == null && row.tracking_type === 'unit') {
        continue;
      }
      if (!stillPlaceholder) continue;
      const unit = String(row.unit_name || '').trim() || 'piece';
      const qty = Number(row.serving_quantity) > 0 ? Number(row.serving_quantity) : 1;
      upd.run(unit, qty, id);
      flipped += 1;
    }
  });
  run();
  return { nulled: nullUnitCosmetic.changes, flipped };
}

function repairHybridIngredientTracking(db) {
  const rows = db
    .prepare(
      `SELECT id, unit_name, serving_quantity FROM label_ingredients
       WHERE tracking_type = 'weight'
         AND (grams_per_serving IS NULL OR grams_per_serving <= 0)
         AND (unit_name IS NOT NULL OR serving_quantity > 0)`
    )
    .all();
  if (rows.length === 0) return 0;

  const upd = db.prepare(
    `UPDATE label_ingredients SET tracking_type = 'unit', unit_name = ?, serving_quantity = ? WHERE id = ?`
  );
  const run = db.transaction(list => {
    for (const r of list) {
      const unit = String(r.unit_name || '').trim() || 'serving';
      const qty = Number(r.serving_quantity) > 0 ? Number(r.serving_quantity) : 1;
      upd.run(unit, qty, r.id);
    }
  });
  run(rows);
  return rows.length;
}

/**
 * Logged ingredient rows used to store a hardcoded "g" even for unit-tracked
 * ingredients, so old breakdowns read "3 g" where they meant "3 eggs". Repairs
 * the display unit in place; amounts and macros were always correct and are
 * left untouched.
 *
 * A row is only relabelled when its stored calories match the count reading
 * (amount / serving_quantity x calories). That check is what makes this safe:
 * if an ingredient was weight-tracked when it was logged and switched to
 * unit-tracked later, its calories won't match, so "170 g" is left alone
 * instead of becoming "170 slices". Idempotent — rows already carrying a real
 * unit name are skipped.
 */
function repairLoggedIngredientUnits(db) {
  const unitTracked = db
    .prepare(`SELECT id, unit_name, serving_quantity, calories FROM label_ingredients WHERE tracking_type = 'unit'`)
    .all();
  if (unitTracked.length === 0) return 0;

  const byId = new Map(unitTracked.map(r => [Number(r.id), r]));
  const entries = db
    .prepare('SELECT id, ingredients_json FROM log_entries WHERE ingredients_json IS NOT NULL')
    .all();
  const updateEntry = db.prepare('UPDATE log_entries SET ingredients_json = ? WHERE id = ?');
  let repaired = 0;

  const run = db.transaction(rows => {
    for (const entry of rows) {
      let parsed;
      try {
        parsed = JSON.parse(entry.ingredients_json);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      let changed = false;
      for (const row of parsed) {
        if (!row || (row.unit !== 'g' && row.unit !== 'oz')) continue;
        const ing = byId.get(Number(row.label_ingredient_id));
        if (!ing) continue;
        const per = Number(ing.serving_quantity) > 0 ? Number(ing.serving_quantity) : 1;
        const expected = (Number(row.amount) / per) * Number(ing.calories);
        const stored = Number(row.calories);
        if (!Number.isFinite(expected) || !Number.isFinite(stored)) continue;
        if (Math.abs(expected - stored) > Math.max(1, Math.abs(expected) * 0.01)) continue;
        row.unit = String(ing.unit_name || '').trim() || 'unit';
        changed = true;
      }
      if (changed) {
        updateEntry.run(JSON.stringify(parsed), entry.id);
        repaired += 1;
      }
    }
  });
  run(entries);
  return repaired;
}

/**
 * MCP log_meal used to insert single-recipe logs with ingredients_json NULL,
 * so those entries had nothing for entryMicros to derive micros from (macros
 * were fine — they come from the recipe row). Fill the missing per-serving
 * snapshot with the same receiptFromRecipeTemplate POST /api/log uses.
 * Touches only live source='mcp' entries linked to a non-quick recipe whose
 * snapshot is NULL; never changes macros. Idempotent.
 */
function repairMcpRecipeEntrySnapshots(db) {
  const { receiptFromRecipeTemplate } = require('./recipeIngredients');
  const entries = db
    .prepare(
      `SELECT le.id, le.user_id, r.id AS rid, r.ingredients, r.meal_builder_meta
         FROM log_entries le
         JOIN recipes r ON r.id = le.recipe_id AND r.user_id = le.user_id
        WHERE le.source = 'mcp' AND le.ingredients_json IS NULL
          AND COALESCE(le.is_deleted, 0) = 0 AND COALESCE(r.is_quick_food, 0) = 0`
    )
    .all();
  if (entries.length === 0) return 0;
  const update = db.prepare('UPDATE log_entries SET ingredients_json = ? WHERE id = ? AND ingredients_json IS NULL');
  let repaired = 0;
  db.transaction(() => {
    for (const e of entries) {
      let receipt = null;
      try {
        receipt = receiptFromRecipeTemplate(
          db, { id: e.rid, ingredients: e.ingredients, meal_builder_meta: e.meal_builder_meta }, e.user_id
        );
      } catch {
        continue;
      }
      if (!receipt?.rows?.length) continue;
      repaired += update.run(JSON.stringify(receipt.rows), e.id).changes;
    }
  })();
  if (repaired) console.log(`[db] repaired ${repaired} MCP recipe log snapshot(s)`);
  return repaired;
}

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

    /* Diet phases: calendar badges marking a cut / bulk / maintenance stretch.
       end_date NULL = ongoing (see server/dietPhases.js). Soft-deleted so MCP
       deletes can be reverted. */
    CREATE TABLE IF NOT EXISTS diet_phases (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      label       TEXT,
      start_date  TEXT NOT NULL,
      end_date    TEXT,
      notes       TEXT,
      source      TEXT NOT NULL DEFAULT 'app',
      is_deleted  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT,
      updated_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_diet_phases_user_start ON diet_phases(user_id, start_date);

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

    /* --- Gym (Setgraph-style per-set logging). Nutrition tables stay above. --- */
    CREATE TABLE IF NOT EXISTS gym_exercises (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL DEFAULT 0,
      name               TEXT NOT NULL,
      primary_muscle     TEXT NOT NULL DEFAULT 'other',
      secondary_muscles  TEXT NOT NULL DEFAULT '[]',
      movement_type      TEXT NOT NULL DEFAULT 'other',
      equipment          TEXT NOT NULL DEFAULT '',
      rest_sec           INTEGER,
      is_deleted         INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gym_exercises_user_name
      ON gym_exercises (user_id, name) WHERE is_deleted = 0;

    CREATE TABLE IF NOT EXISTS gym_templates (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL,
      name               TEXT NOT NULL,
      split_label        TEXT,
      notes              TEXT,
      progression_notes  TEXT,
      is_deleted         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS gym_template_exercises (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      template_id    INTEGER NOT NULL,
      exercise_id    INTEGER NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      target_sets    INTEGER,
      target_reps    INTEGER,
      target_weight  REAL,
      rest_sec       INTEGER,
      notes          TEXT,
      FOREIGN KEY (template_id) REFERENCES gym_templates(id),
      FOREIGN KEY (exercise_id) REFERENCES gym_exercises(id)
    );

    CREATE TABLE IF NOT EXISTS gym_schedule (
      user_id       INTEGER NOT NULL,
      weekday       INTEGER NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      enabled       INTEGER NOT NULL DEFAULT 0,
      template_id   INTEGER,
      duration_min  INTEGER,
      PRIMARY KEY (user_id, weekday)
    );

    CREATE TABLE IF NOT EXISTS gym_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      date           TEXT NOT NULL,
      started_at     TEXT NOT NULL,
      ended_at       TEXT,
      duration_sec   INTEGER,
      activity_type  TEXT NOT NULL DEFAULT 'strength',
      template_id    INTEGER,
      notes          TEXT
    );

    CREATE TABLE IF NOT EXISTS gym_sets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      session_id   INTEGER NOT NULL,
      exercise_id  INTEGER NOT NULL,
      set_index    INTEGER NOT NULL,
      reps         INTEGER,
      weight       REAL,
      weight_unit  TEXT,
      is_warmup    INTEGER NOT NULL DEFAULT 0,
      is_1rm       INTEGER NOT NULL DEFAULT 0,
      note         TEXT,
      logged_at    TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES gym_sessions(id),
      FOREIGN KEY (exercise_id) REFERENCES gym_exercises(id)
    );

    CREATE TABLE IF NOT EXISTS gym_one_rep_maxes (
      user_id      INTEGER NOT NULL,
      exercise_id  INTEGER NOT NULL,
      estimated    REAL,
      tested       REAL,
      formula      TEXT,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (user_id, exercise_id)
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

    /* Soft personal meal prep / plan-ahead drafts (not logged until client applies) */
    CREATE TABLE IF NOT EXISTS day_prep_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      date         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'planned',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    /* Coach suggestions — client applies into their own notebook */
    CREATE TABLE IF NOT EXISTS coach_day_suggestions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_user_id   INTEGER NOT NULL,
      client_user_id  INTEGER NOT NULL,
      for_date        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'offered',
      note            TEXT,
      payload_json    TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at    TEXT
    );

    /* Cooked ingredient batches — fixed total weight + macros, depletes on log */
    CREATE TABLE IF NOT EXISTS prepped_batches (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      name                 TEXT NOT NULL,
      total_weight_g       REAL NOT NULL,
      remaining_weight_g   REAL NOT NULL,
      total_calories       REAL NOT NULL,
      total_protein_g      REAL NOT NULL,
      total_carbs_g        REAL NOT NULL,
      total_fat_g          REAL NOT NULL,
      total_fiber_g        REAL DEFAULT 0,
      remaining_calories   REAL NOT NULL,
      remaining_protein_g  REAL NOT NULL,
      remaining_carbs_g    REAL NOT NULL,
      remaining_fat_g      REAL NOT NULL,
      remaining_fiber_g    REAL DEFAULT 0,
      label_ingredient_id  INTEGER,
      is_depleted          INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  // Cached micronutrients for the recipe's DEFAULT ingredients, so browsing the
  // library doesn't pay for an AI estimate on every expand. The fingerprint is a
  // hash of the ingredients the estimate was computed from — when the recipe is
  // edited it stops matching and the cache is recomputed on next request.
  if (recipeCols.length && !recipeCols.includes('micros_json')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN micros_json TEXT`);
  }
  if (recipeCols.length && !recipeCols.includes('micros_fingerprint')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN micros_fingerprint TEXT`);
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
  // Density (g per ml): the bridge between weight and volume, so a weighed
  // food can be logged by the cup and a liquid by the gram. See unitConvert.js.
  if (labelCols.length && !labelCols.includes('grams_per_ml')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN grams_per_ml REAL`);
  }
  // "Servings per container" off the label — lets meal prep enter a whole bag
  // or box as an amount instead of doing the multiplication by hand.
  if (labelCols.length && !labelCols.includes('servings_per_container')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN servings_per_container REAL`);
  }
  // Product barcode (EAN/UPC digits) when the ingredient came from a scan —
  // lets a re-scan find the saved item instead of adding a near-duplicate.
  if (labelCols.length && !labelCols.includes('barcode')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN barcode TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_label_ingredients_barcode ON label_ingredients (user_id, barcode)`);
  }
  // Per-serving micronutrients read off the product's own panel (currently via
  // barcode import). Stored as the standard micros blob so log-time estimation
  // can prefer these over an AI guess.
  if (labelCols.length && !labelCols.includes('micros_json')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN micros_json TEXT`);
  }
  repairHybridIngredientTracking(db);
  repairLoggedIngredientUnits(db);
  repairPlaceholderGramsPerServing(db);

  // Supplements: separate the label's serving from the amount actually taken.
  // Stored macros/micros are per LABEL serving (that's what every capture path
  // reports), so dose_qty / label_serving_qty is the factor applied downstream.
  const supplementDoseCols = db.prepare('PRAGMA table_info(supplements)').all().map(c => c.name);
  if (supplementDoseCols.length && !supplementDoseCols.includes('label_serving_qty')) {
    db.exec(`ALTER TABLE supplements ADD COLUMN label_serving_qty REAL`);
    db.exec(`ALTER TABLE supplements ADD COLUMN label_serving_unit TEXT`);
    db.exec(`ALTER TABLE supplements ADD COLUMN dose_qty REAL`);
    // Backfill from the free-text dose ("2 Capsules" -> 2 capsule). Dose starts
    // equal to the label serving, so every existing supplement keeps counting
    // exactly what it counted before — this migration changes no totals.
    const rows = db.prepare('SELECT id, dose_text FROM supplements').all();
    const upd = db.prepare(
      'UPDATE supplements SET label_serving_qty = ?, label_serving_unit = ?, dose_qty = ? WHERE id = ?'
    );
    const backfill = db.transaction(list => {
      for (const row of list) {
        const parsed = parseServingText(row.dose_text) || { qty: 1, unit: 'serving' };
        upd.run(parsed.qty, parsed.unit, parsed.qty, row.id);
      }
    });
    backfill(rows);
  }
  // Per-day amount. NULL means "my usual dose", so the checklist stays one tap
  // and only days you deliberately change carry their own number.
  const supplementLogCols = db.prepare('PRAGMA table_info(supplement_log)').all().map(c => c.name);
  if (supplementLogCols.length && !supplementLogCols.includes('dose_qty')) {
    db.exec(`ALTER TABLE supplement_log ADD COLUMN dose_qty REAL`);
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
  if (profileCols.length && !profileCols.includes('dash_layout_json')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_layout_json TEXT`);
  }
  if (profileCols.length && !profileCols.includes('dash_weight_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_weight_enabled INTEGER DEFAULT 1`);
  }
  if (profileCols.length && !profileCols.includes('dash_meals_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_meals_enabled INTEGER DEFAULT 1`);
  }
  if (profileCols.length && !profileCols.includes('dash_weight_chart_card_enabled')) {
    db.exec(`ALTER TABLE user_profile ADD COLUMN dash_weight_chart_card_enabled INTEGER DEFAULT 0`);
  }

  // MCP Phase 2/3: permanent source flags + audit trail.
  // `source` / `created_via` are never cleared; UI uses them for badges and bulk undo.
  // Who wrote a weigh-in (app | mcp) — MCP writes are flagged like meals are.
  const bodyWeightCols = db.prepare('PRAGMA table_info(body_weights)').all().map(c => c.name);
  if (bodyWeightCols.length && !bodyWeightCols.includes('source')) {
    db.exec(`ALTER TABLE body_weights ADD COLUMN source TEXT NOT NULL DEFAULT 'app'`);
  }
  const logColsMcp = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
  if (logColsMcp.length && !logColsMcp.includes('source')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'app'`);
  }
  if (logColsMcp.length && !logColsMcp.includes('weight_basis')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN weight_basis TEXT`);
  }
  if (logColsMcp.length && !logColsMcp.includes('nutrition_source')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN nutrition_source TEXT`);
  }
  // Soft-delete for meal log rows (MCP + app). Reads must filter is_deleted = 0.
  if (logColsMcp.length && !logColsMcp.includes('is_deleted')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`);
  }
  // user_id is added by auth migrations; only index when present.
  const logColsAfterSoft = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
  if (logColsAfterSoft.includes('user_id') && logColsAfterSoft.includes('is_deleted')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_log_entries_user_date_alive
        ON log_entries(user_id, date)
        WHERE COALESCE(is_deleted, 0) = 0
    `);
  }

  const labelColsMcp = db.prepare('PRAGMA table_info(label_ingredients)').all().map(c => c.name);
  if (labelColsMcp.length && !labelColsMcp.includes('created_via')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN created_via TEXT NOT NULL DEFAULT 'app'`);
  }
  if (labelColsMcp.length && !labelColsMcp.includes('weight_basis')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN weight_basis TEXT`);
  }
  if (labelColsMcp.length && !labelColsMcp.includes('nutrition_source')) {
    db.exec(`ALTER TABLE label_ingredients ADD COLUMN nutrition_source TEXT`);
  }

  const supplementColsMcp = db.prepare('PRAGMA table_info(supplements)').all().map(c => c.name);
  if (supplementColsMcp.length && !supplementColsMcp.includes('created_via')) {
    db.exec(`ALTER TABLE supplements ADD COLUMN created_via TEXT NOT NULL DEFAULT 'app'`);
  }

  // Phase 3: proposals handshake removed — drop leftover Phase 2 table.
  db.exec(`DROP TABLE IF EXISTS mcp_proposals`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_write_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      proposal_id TEXT,
      kind TEXT NOT NULL,
      confirmation_code TEXT NOT NULL DEFAULT '',
      user_confirmation_text TEXT NOT NULL DEFAULT '',
      preview_json TEXT NOT NULL DEFAULT '{}',
      result_row_ids_json TEXT NOT NULL DEFAULT '{}',
      operation_id TEXT,
      created_at TEXT NOT NULL,
      op TEXT,
      before_json TEXT,
      after_json TEXT,
      response_json TEXT,
      warnings_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_write_audit_user_created
      ON mcp_write_audit(user_id, created_at);
  `);

  const auditCols = db.prepare('PRAGMA table_info(mcp_write_audit)').all().map(c => c.name);
  if (auditCols.length && !auditCols.includes('op')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN op TEXT`);
  }
  if (auditCols.length && !auditCols.includes('before_json')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN before_json TEXT`);
  }
  if (auditCols.length && !auditCols.includes('after_json')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN after_json TEXT`);
  }
  if (auditCols.length && !auditCols.includes('response_json')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN response_json TEXT`);
  }
  if (auditCols.length && !auditCols.includes('warnings_json')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN warnings_json TEXT`);
  }
  if (auditCols.length && !auditCols.includes('reverted_at')) {
    db.exec(`ALTER TABLE mcp_write_audit ADD COLUMN reverted_at TEXT`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_write_audit_user_op
      ON mcp_write_audit(user_id, operation_id)
      WHERE operation_id IS NOT NULL AND operation_id != '';
  `);

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

  const { GYM_EXERCISES } = require('./gymCatalog');

  // Seed exercise library if empty
  const libCount = db.prepare('SELECT COUNT(*) AS n FROM exercise_library').get().n;
  if (libCount === 0) {
    const insertExercise = db.prepare(
      `INSERT OR IGNORE INTO exercise_library (name, primary_muscle, secondary_muscles, movement_type, equipment)
       VALUES (?, ?, ?, ?, ?)`
    );
    const seedExercises = db.transaction(() => {
      for (const row of GYM_EXERCISES) insertExercise.run(...row);
    });
    seedExercises();
  }

  const gymLibCount = db.prepare('SELECT COUNT(*) AS n FROM gym_exercises WHERE user_id = 0').get().n;
  if (gymLibCount === 0) {
    const insertGym = db.prepare(
      `INSERT OR IGNORE INTO gym_exercises (user_id, name, primary_muscle, secondary_muscles, movement_type, equipment)
       VALUES (0, ?, ?, ?, ?, ?)`
    );
    const seedGym = db.transaction(() => {
      for (const row of GYM_EXERCISES) insertGym.run(...row);
    });
    seedGym();
  }

  const { migrateLegacyUserZero } = require('./authService');
  migrateLegacyUserZero(db);

  repairMcpRecipeEntrySnapshots(db);

  return db;
}

module.exports = {
  createDb,
  repairLoggedIngredientUnits,
  repairHybridIngredientTracking,
  repairPlaceholderGramsPerServing,
  repairMcpRecipeEntrySnapshots,
};
