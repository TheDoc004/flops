/**
 * Worker: run one SELECT on a read-only SQLite connection with user TEMP VIEW shadows.
 * workerData: { dbPath?, dbBuffer?, userId, sql, maxRows, skipParse? }
 */
const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const { validateSelectSql } = require('./queryValidate');
const {
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  MAX_ROWS,
} = require('./queryAllowlist');

function openReadonly(dbPath, dbBuffer) {
  if (dbBuffer) {
    const buf = Buffer.isBuffer(dbBuffer) ? dbBuffer : Buffer.from(dbBuffer);
    return new Database(buf, { readonly: true });
  }
  if (!dbPath || dbPath === ':memory:') {
    throw new Error('Readonly query requires dbPath or dbBuffer');
  }
  return new Database(dbPath, { readonly: true });
}

function installShadows(db, userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Invalid user id');

  const shadowed = new Set();

  for (const table of USER_SCOPED_TABLES) {
    db.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE user_id = ${uid}`
    );
    shadowed.add(table);
  }
  for (const table of COACH_SCOPED_TABLES) {
    db.exec(
      `CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"
        WHERE coach_user_id = ${uid} OR client_user_id = ${uid}`
    );
    shadowed.add(table);
  }
  for (const table of GLOBAL_READ_TABLES) {
    db.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}"`);
    shadowed.add(table);
  }
  for (const table of BLOCKED_TABLES) {
    db.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE 0`);
    shadowed.add(table);
  }

  // Empty-shadow any other real tables so forgotten tables cannot leak.
  const extras = db
    .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all();
  for (const { name } of extras) {
    if (shadowed.has(name)) continue;
    db.exec(`CREATE TEMP VIEW "${name}" AS SELECT * FROM main."${name}" WHERE 0`);
  }
}

function run() {
  const {
    dbPath,
    dbBuffer,
    userId,
    sql: rawSql,
    maxRows = MAX_ROWS,
    skipParse = false,
  } = workerData || {};

  const started = Date.now();
  const checked = validateSelectSql(rawSql, { skipParse: !!skipParse });
  if (checked.error) {
    parentPort.postMessage({ error: checked.error, elapsed_ms: Date.now() - started });
    return;
  }

  let db;
  try {
    db = openReadonly(dbPath, dbBuffer);
    installShadows(db, userId);

    const stmt = db.prepare(checked.sql);
    if (!stmt.reader) {
      parentPort.postMessage({
        error: 'Statement is not a read-only SELECT',
        elapsed_ms: Date.now() - started,
      });
      return;
    }

    const limit = Math.min(Math.max(1, Number(maxRows) || MAX_ROWS), MAX_ROWS);
    const rows = stmt.all();
    const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
    const truncated = rows.length > limit;
    const sliced = truncated ? rows.slice(0, limit) : rows;

    parentPort.postMessage({
      columns,
      rows: sliced,
      row_count: sliced.length,
      truncated,
      total_matched: rows.length,
      elapsed_ms: Date.now() - started,
    });
  } catch (err) {
    parentPort.postMessage({
      error: err.message || 'Query failed',
      code: err.code || null,
      elapsed_ms: Date.now() - started,
    });
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

run();
