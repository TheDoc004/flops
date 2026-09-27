/**
 * MCP read-only SQL query: CST-validated SELECT/WITH, separate readonly connection,
 * user-scoped TEMP VIEW shadows, 1000-row cap, 5s Worker timeout.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const { validateSelectSql } = require('./queryValidate');
const { runSync } = require('./querySync');
const {
  ALLOWLISTED_TABLES,
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
} = require('./queryAllowlist');

function readonlySource(db) {
  const name = db?.name;
  if (name && name !== ':memory:' && !String(name).startsWith('file::memory:')) {
    return { dbPath: name };
  }
  return { dbBuffer: db.serialize() };
}

/**
 * Run validated SELECT for one user (Worker + 5s timeout).
 * @returns {Promise<object>}
 */
function runUserQuery(db, userId, rawSql, {
  maxRows = MAX_ROWS,
  timeoutMs = QUERY_TIMEOUT_MS,
  skipParse = false,
} = {}) {
  const pre = validateSelectSql(rawSql, { skipParse });
  if (pre.error) {
    return Promise.resolve({ error: pre.error, elapsed_ms: 0 });
  }

  const workerData = {
    ...readonlySource(db),
    userId,
    sql: pre.sql,
    maxRows,
    skipParse,
  };

  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'queryWorker.js'), { workerData });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish({
        error: `Query timed out after ${timeoutMs}ms`,
        elapsed_ms: Date.now() - started,
      });
    }, timeoutMs);

    worker.on('message', (msg) => {
      worker.terminate().catch(() => {});
      finish(msg);
    });
    worker.on('error', (err) => {
      finish({ error: err.message || 'Worker failed', elapsed_ms: Date.now() - started });
    });
    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish({
          error: `Query worker exited with code ${code}`,
          elapsed_ms: Date.now() - started,
        });
      }
    });
  });
}

/** In-process path for tests (incl. skipParse → SQLITE_READONLY proof). */
function runUserQueryInProcess(db, userId, rawSql, opts) {
  return runSync(db, userId, rawSql, opts);
}

/**
 * describe_schema — columns, types, FKs for allowlisted tables only.
 */
function describeSchema(db) {
  const tables = [];
  for (const name of ALLOWLISTED_TABLES) {
    const exists = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name);
    if (!exists) continue;
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => ({
      name: c.name,
      type: c.type || '',
      notnull: !!c.notnull,
      pk: !!c.pk,
      dflt_value: c.dflt_value,
    }));
    const foreign_keys = db.prepare(`PRAGMA foreign_key_list("${name}")`).all().map((fk) => ({
      id: fk.id,
      table: fk.table,
      from: fk.from,
      to: fk.to,
      on_update: fk.on_update,
      on_delete: fk.on_delete,
    }));
    let scope = 'user';
    if (GLOBAL_READ_TABLES.includes(name)) scope = 'global';
    else if (COACH_SCOPED_TABLES.includes(name)) scope = 'coach';
    tables.push({ name, scope, columns, foreign_keys });
  }
  return {
    note:
      'query() auto-scopes user/coach tables to the bound MCP user. ' +
      'Auth tables are not listed and are not readable.',
    tables,
  };
}

module.exports = {
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  ALLOWLISTED_TABLES,
  validateSelectSql,
  runUserQuery,
  runUserQueryInProcess,
  describeSchema,
  readonlySource,
};
