/**
 * In-process readonly query (tests / SQLITE_READONLY proofs). Same shadows as the Worker.
 */
const Database = require('better-sqlite3');
const { validateSelectSql } = require('./queryValidate');
const {
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  MAX_ROWS,
} = require('./queryAllowlist');

function openReadonlyFrom(db) {
  const name = db?.name;
  if (name && name !== ':memory:' && !String(name).startsWith('file::memory:')) {
    return new Database(name, { readonly: true });
  }
  return new Database(db.serialize(), { readonly: true });
}

function installShadows(ro, userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Invalid user id');
  const shadowed = new Set();
  for (const table of USER_SCOPED_TABLES) {
    ro.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE user_id = ${uid}`
    );
    shadowed.add(table);
  }
  for (const table of COACH_SCOPED_TABLES) {
    ro.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"
        WHERE coach_user_id = ${uid} OR client_user_id = ${uid}`
    );
    shadowed.add(table);
  }
  for (const table of GLOBAL_READ_TABLES) {
    ro.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"`);
    shadowed.add(table);
  }
  for (const table of BLOCKED_TABLES) {
    ro.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE 0`);
    shadowed.add(table);
  }
  const extras = ro
    .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all();
  for (const { name } of extras) {
    if (shadowed.has(name)) continue;
    ro.exec(`CREATE TEMP VIEW "${name}" AS SELECT * FROM main."${name}" WHERE 0`);
  }
}

function runSync(db, userId, rawSql, { maxRows = MAX_ROWS, skipParse = false } = {}) {
  const started = Date.now();
  const checked = validateSelectSql(rawSql, { skipParse });
  if (checked.error) return { error: checked.error, elapsed_ms: Date.now() - started };

  let ro;
  try {
    ro = openReadonlyFrom(db);
    installShadows(ro, userId);
    const stmt = ro.prepare(checked.sql);
    if (!stmt.reader) {
      return { error: 'Statement is not a read-only SELECT', elapsed_ms: Date.now() - started };
    }
    const limit = Math.min(Math.max(1, Number(maxRows) || MAX_ROWS), MAX_ROWS);
    const rows = stmt.all();
    const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
    const truncated = rows.length > limit;
    return {
      columns,
      rows: truncated ? rows.slice(0, limit) : rows,
      row_count: truncated ? limit : rows.length,
      truncated,
      total_matched: rows.length,
      elapsed_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      error: err.message || 'Query failed',
      code: err.code || null,
      elapsed_ms: Date.now() - started,
    };
  } finally {
    try {
      ro?.close();
    } catch {
      // ignore
    }
  }
}

module.exports = { runSync, openReadonlyFrom, installShadows };
