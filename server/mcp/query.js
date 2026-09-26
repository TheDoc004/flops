/**
 * Guarded read-only SQL for FLOPS MCP.
 *
 * SELECT/WITH only. User-scoped tables are shadowed by TEMP VIEWs filtered to
 * MCP_USER_ID so agents cannot read other users' rows even if they omit
 * `user_id = …`. Secret tables get empty shadow views. Schema qualifiers
 * (main./temp.) are refused so callers cannot bypass the shadows.
 */

const MAX_SQL_CHARS = 4000;
const MAX_ROWS = 200;

/** App notebook tables that carry user_id — shadowed to the bound user. */
const USER_SCOPED_TABLES = [
  'log_entries',
  'recipes',
  'label_ingredients',
  'supplements',
  'supplement_log',
  'day_goals',
  'day_goal_versions',
  'user_profile',
  'body_weights',
  'gym_exercises',
  'gym_templates',
  'gym_template_exercises',
  'gym_schedule',
  'gym_sessions',
  'gym_sets',
  'gym_one_rep_maxes',
  'mcp_write_audit',
  'day_prep_items',
  'prepped_batches',
  'workout_presets',
  'workout_preset_exercises',
  'workout_day_selections',
  'exercise_logs',
  'training_schedule',
  'training_overrides',
  'training_feedback',
  'daily_training_context',
  'training_saved_recipes',
  'ai_usage',
];

/** Tables scoped by coach_user_id / client_user_id instead of user_id. */
const COACH_SCOPED_TABLES = ['coach_day_suggestions', 'coach_links'];

/** Shared catalogs (no user_id) — full read via temp shadow. */
const GLOBAL_READ_TABLES = ['exercise_library'];

/** Never expose row data — empty shadow views. */
const BLOCKED_TABLES = [
  'users',
  'sessions',
  'email_otps',
  'organizations',
  'org_memberships',
];

const FORBIDDEN_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|GRANT|REVOKE|TRUNCATE|INTO\s+OUTFILE|LOAD\s+EXTENSION|LOAD_EXTENSION)\b/i;

const FORBIDDEN_IDENT =
  /\b(sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema)\b/i;

function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  const s = String(sql);
  while (i < s.length) {
    if (s[i] === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (s[i] === "'" ) {
      out += s[i++];
      while (i < s.length) {
        out += s[i];
        if (s[i] === "'" && s[i + 1] === "'") {
          out += s[++i];
          i += 1;
          continue;
        }
        if (s[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += s[i++];
  }
  return out;
}

function validateSelectSql(rawSql) {
  if (rawSql == null || typeof rawSql !== 'string') {
    return { error: 'sql must be a string' };
  }
  const cleaned = stripSqlComments(rawSql).trim().replace(/;+\s*$/g, '');
  if (!cleaned) return { error: 'Empty SQL' };
  if (cleaned.length > MAX_SQL_CHARS) {
    return { error: `SQL exceeds ${MAX_SQL_CHARS} characters` };
  }
  if (cleaned.includes(';')) {
    return { error: 'Multiple statements are not allowed' };
  }
  if (!/^(WITH|SELECT)\b/i.test(cleaned)) {
    return { error: 'Only SELECT or WITH … SELECT queries are allowed' };
  }
  if (FORBIDDEN_KEYWORD.test(cleaned)) {
    return { error: 'Forbidden keyword in SQL (read-only SELECT/WITH)' };
  }
  if (FORBIDDEN_IDENT.test(cleaned)) {
    return { error: 'Querying sqlite system catalogs is not allowed' };
  }
  if (/\b(main|temp)\s*\./i.test(cleaned)) {
    return { error: 'Schema-qualified table names (main./temp.) are not allowed' };
  }
  return { sql: cleaned };
}

function dropShadowViews(db) {
  const all = [
    ...USER_SCOPED_TABLES,
    ...COACH_SCOPED_TABLES,
    ...GLOBAL_READ_TABLES,
    ...BLOCKED_TABLES,
  ];
  for (const table of all) {
    try {
      db.exec(`DROP VIEW IF EXISTS "${table}"`);
    } catch {
      // ignore
    }
  }
}

function installShadowViews(db, userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error('Invalid user id for query shadows');
  }
  dropShadowViews(db);
  for (const table of USER_SCOPED_TABLES) {
    db.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE user_id = ${uid}`
    );
  }
  for (const table of COACH_SCOPED_TABLES) {
    db.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"
        WHERE coach_user_id = ${uid} OR client_user_id = ${uid}`
    );
  }
  for (const table of GLOBAL_READ_TABLES) {
    db.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"`);
  }
  for (const table of BLOCKED_TABLES) {
    db.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE 0`);
  }
}

/**
 * Run a validated SELECT for one user. Returns { rows, row_count, truncated? } or { error }.
 */
function runUserQuery(db, userId, rawSql, { maxRows = MAX_ROWS } = {}) {
  const checked = validateSelectSql(rawSql);
  if (checked.error) return { error: checked.error };

  const limit = Math.min(Math.max(1, Number(maxRows) || MAX_ROWS), MAX_ROWS);

  try {
    return db.transaction(() => {
      installShadowViews(db, userId);
      try {
        const stmt = db.prepare(checked.sql);
        if (!stmt.reader) {
          return { error: 'Statement is not a read-only SELECT' };
        }
        const rows = stmt.all();
        if (rows.length > limit) {
          return {
            rows: rows.slice(0, limit),
            row_count: limit,
            truncated: true,
            total_matched: rows.length,
            note: `Result truncated to ${limit} rows; add a LIMIT in SQL for precise windows.`,
          };
        }
        return { rows, row_count: rows.length, truncated: false };
      } finally {
        dropShadowViews(db);
      }
    })();
  } catch (err) {
    try {
      dropShadowViews(db);
    } catch {
      // ignore
    }
    return { error: err.message || 'Query failed' };
  }
}

module.exports = {
  MAX_SQL_CHARS,
  MAX_ROWS,
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  validateSelectSql,
  runUserQuery,
};
