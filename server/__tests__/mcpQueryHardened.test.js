const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../db');
const { createUser } = require('./helpers');
const {
  validateSelectSql,
  runUserQuery,
  runUserQueryInProcess,
  describeSchema,
  MAX_ROWS,
} = require('../mcp/query');
const { openReadonlyFrom } = require('../mcp/querySync');
const reads = require('../mcp/reads');
const { buildMicrosBlob } = require('../microNutrients');

function seedLibrary(db, userId, count) {
  const ins = db.prepare(
    `INSERT INTO label_ingredients (
       user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
       source_type, tracking_type, micros_json, use_count
     ) VALUES (?, ?, '100 g', 100, 100, 10, 10, 1, 'manual', 'weight', ?, ?)`
  );
  for (let i = 1; i <= count; i += 1) {
    const withMicros = i % 3 === 0;
    const blob = withMicros
      ? JSON.stringify(buildMicrosBlob({ iron_mg: 1 }, { confidence: 'high', notes: 't' }))
      : null;
    ins.run(userId, `Food ${String(i).padStart(3, '0')}`, blob, count - i);
  }
}

describe('validateSelectSql (CST)', () => {
  it('accepts SELECT and WITH', () => {
    expect(validateSelectSql('SELECT id, name FROM label_ingredients').error).toBeUndefined();
    expect(validateSelectSql('WITH x AS (SELECT 1 AS a) SELECT * FROM x').error).toBeUndefined();
  });

  it('rejects writes, pragma, attach, multi-statement incl. comment-obfuscated', () => {
    expect(validateSelectSql('INSERT INTO label_ingredients DEFAULT VALUES').error).toMatch(/Only SELECT|got insert/);
    expect(validateSelectSql('UPDATE label_ingredients SET name = 1').error).toMatch(/Only SELECT|got update/);
    expect(validateSelectSql('DELETE FROM log_entries').error).toMatch(/Only SELECT|got delete/);
    expect(validateSelectSql('DROP TABLE label_ingredients').error).toMatch(/Only SELECT|got drop/);
    expect(validateSelectSql('PRAGMA table_info(label_ingredients)').error).toMatch(/Only SELECT|got pragma/);
    expect(validateSelectSql('ATTACH DATABASE "x.db" AS x').error).toMatch(/Only SELECT|got attach/);
    expect(validateSelectSql('SELECT 1; DROP TABLE label_ingredients').error).toMatch(/Multiple/);
    expect(validateSelectSql('SELECT 1 /* comment */ ; DELETE FROM meals').error).toMatch(/Multiple/);
    expect(validateSelectSql('SELECT * FROM main.label_ingredients').error).toMatch(/Schema-qualified/);
    expect(validateSelectSql('SELECT * FROM sqlite_master').error).toMatch(/system catalogs/);
  });
});

describe('runUserQuery', () => {
  let db;
  let userA;
  let userB;

  beforeEach(() => {
    db = createDb(':memory:');
    userA = createUser(db, 'a@query.test').id;
    userB = createUser(db, 'b@query.test').id;
    seedLibrary(db, userA, 60);
    // B gets one row so isolation is testable
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type
       ) VALUES (?, 'Only B', '1', 100, 1, 1, 1, 1, 'manual', 'weight')`
    ).run(userB);
  });

  it('returns complete null-micros list without a 50-row search cap', async () => {
    const res = await runUserQuery(
      db,
      userA,
      `SELECT id, name FROM label_ingredients WHERE micros_json IS NULL ORDER BY name`
    );
    expect(res.error).toBeUndefined();
    expect(res.truncated).toBe(false);
    expect(res.columns).toEqual(['id', 'name']);
    // 60 foods, every i%3!==0 has null micros → 40
    expect(res.row_count).toBe(40);
    expect(res.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('supports JOIN and aggregates and CTEs', async () => {
    const recipeId = db
      .prepare(
        `INSERT INTO recipes (
           user_id, name, serving_size, calories, protein_g, carbs_g, fat_g
         ) VALUES (?, 'Join Meal', '1 serving', 100, 10, 10, 1)`
      )
      .run(userA).lastInsertRowid;
    db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, time_min, servings, recipe_name, serving_size,
         recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g
       ) VALUES (?, ?, '2026-09-26', 720, 1, 'x', '1', 100, 10, 10, 1)`
    ).run(userA, recipeId);

    const join = await runUserQuery(
      db,
      userA,
      `SELECT COUNT(*) AS n FROM log_entries le JOIN label_ingredients li ON li.user_id = le.user_id`
    );
    expect(join.error).toBeUndefined();
    expect(join.rows[0].n).toBeGreaterThan(0);

    const agg = await runUserQuery(
      db,
      userA,
      `SELECT COUNT(*) AS n FROM label_ingredients GROUP BY user_id`
    );
    expect(agg.rows[0].n).toBe(60);

    const cte = await runUserQuery(
      db,
      userA,
      `WITH missing AS (
         SELECT id FROM label_ingredients WHERE micros_json IS NULL
       ) SELECT COUNT(*) AS n FROM missing`
    );
    expect(cte.rows[0].n).toBe(40);
  });

  it('scopes rows to the bound user and blanks auth tables', async () => {
    const names = await runUserQuery(db, userA, `SELECT name FROM label_ingredients ORDER BY name`);
    expect(names.rows.every((r) => r.name !== 'Only B')).toBe(true);

    const users = await runUserQuery(db, userA, `SELECT * FROM users`);
    expect(users.rows).toEqual([]);

    const sessions = await runUserQuery(db, userA, `SELECT * FROM sessions`);
    expect(sessions.rows).toEqual([]);
  });

  it('sets truncated when over 1000 rows', async () => {
    // Generate >1000 rows via a numbers CTE
    const sql = `
      WITH RECURSIVE n(x) AS (
        SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 1005
      )
      SELECT x FROM n
    `;
    const res = await runUserQuery(db, userA, sql);
    expect(res.error).toBeUndefined();
    expect(res.truncated).toBe(true);
    expect(res.row_count).toBe(MAX_ROWS);
    expect(res.total_matched).toBe(1005);
  });

  it('times out a deliberately slow query around 5s', async () => {
    const sql = `
      WITH RECURSIVE n(x) AS (
        SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 100000000
      )
      SELECT COUNT(*) AS n FROM n
    `;
    const res = await runUserQuery(db, userA, sql, { timeoutMs: 500 });
    expect(res.error).toMatch(/timed out/i);
    expect(res.elapsed_ms).toBeGreaterThanOrEqual(400);
  }, 15000);

  it('readonly connection refuses writes even when parser is skipped', () => {
    // Statement-level gate: non-SELECT never runs (even with skipParse).
    const res = runUserQueryInProcess(
      db,
      userA,
      `INSERT INTO main.label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type
       ) VALUES (${userA}, 'hack', '1', 100, 1, 1, 1, 1, 'manual', 'weight')`,
      { skipParse: true }
    );
    expect(res.error).toMatch(/not a read-only SELECT|READONLY|readonly/i);

    // Driver-level gate: separate {readonly:true} connection rejects durable writes.
    const ro = openReadonlyFrom(db);
    try {
      expect(() => ro.exec('CREATE TABLE hack_ro_proof (x INTEGER)')).toThrow(/readonly/i);
    } finally {
      ro.close();
    }
    const stillMissing = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE name = 'hack_ro_proof'`)
      .get();
    expect(stillMissing).toBeUndefined();
  });
});

describe('describe_schema', () => {
  it('lists allowlisted tables with columns and omits users/sessions', () => {
    const db = createDb(':memory:');
    const schema = describeSchema(db);
    const names = schema.tables.map((t) => t.name);
    expect(names).toContain('label_ingredients');
    expect(names).toContain('log_entries');
    expect(names).not.toContain('users');
    expect(names).not.toContain('sessions');
    const li = schema.tables.find((t) => t.name === 'label_ingredients');
    expect(li.columns.some((c) => c.name === 'micros_json')).toBe(true);
    expect(Array.isArray(li.foreign_keys)).toBe(true);
  });
});

describe('search_ingredients offset + has_micros', () => {
  it('paginates past 50 and filters missing micros', () => {
    const db = createDb(':memory:');
    const userId = createUser(db, 'search@query.test').id;
    seedLibrary(db, userId, 60);

    const page1 = reads.searchIngredients(db, userId, '', { limit: 50, offset: 0 });
    expect(page1.ingredients).toHaveLength(50);
    expect(page1.total_matched).toBe(60);

    const page2 = reads.searchIngredients(db, userId, '', { limit: 50, offset: 50 });
    expect(page2.ingredients).toHaveLength(10);
    expect(page2.offset).toBe(50);

    const missing = reads.searchIngredients(db, userId, '', { has_micros: false, limit: 50 });
    expect(missing.total_matched).toBe(40);
    expect(missing.ingredients.every((r) => r.has_micros === false)).toBe(true);

    const present = reads.searchIngredients(db, userId, '', { has_micros: true, limit: 50 });
    expect(present.total_matched).toBe(20);
  });
});
