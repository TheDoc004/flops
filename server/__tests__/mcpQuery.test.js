const { createDb } = require('../db');
const { createUser } = require('./helpers');
const { runUserQuery, validateSelectSql } = require('../mcp/query');
const { buildMicrosBlob } = require('../microNutrients');

describe('MCP query tool', () => {
  it('rejects non-SELECT and writes', () => {
    expect(validateSelectSql('DELETE FROM log_entries').error).toMatch(/Only SELECT/);
    expect(validateSelectSql('SELECT 1; SELECT 2').error).toMatch(/Multiple/);
    expect(validateSelectSql('SELECT * FROM main.log_entries').error).toMatch(/Schema-qualified/);
    expect(validateSelectSql('PRAGMA table_info(users)').error).toMatch(/Only SELECT|Forbidden/);
  });

  it('returns only the bound user’s rows', () => {
    const db = createDb(':memory:');
    const a = createUser(db, 'a@query.test').id;
    const b = createUser(db, 'b@query.test').id;
    const blob = JSON.stringify(
      buildMicrosBlob({ omega3_epa_mg: 100 }, { confidence: 'high', notes: 't' })
    );
    db.prepare(
      `INSERT INTO supplements (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g,
        counts_toward_macros, micros_json, sort_order, label_serving_qty, label_serving_unit, dose_qty)
       VALUES (?, 'A oil', '1', 0, 0, 0, 0, 0, ?, 0, 1, 'sg', 1)`
    ).run(a, blob);
    db.prepare(
      `INSERT INTO supplements (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g,
        counts_toward_macros, micros_json, sort_order, label_serving_qty, label_serving_unit, dose_qty)
       VALUES (?, 'B oil', '1', 0, 0, 0, 0, 0, ?, 0, 1, 'sg', 1)`
    ).run(b, blob);

    const res = runUserQuery(db, a, 'SELECT name FROM supplements ORDER BY name');
    expect(res.error).toBeUndefined();
    expect(res.rows.map((r) => r.name)).toEqual(['A oil']);
  });

  it('does not leak sessions/users rows', () => {
    const db = createDb(':memory:');
    const a = createUser(db, 'secret@query.test').id;
    const res = runUserQuery(db, a, 'SELECT * FROM users');
    expect(res.error).toBeUndefined();
    expect(res.rows).toEqual([]);
  });

  it('allows exercise_library reads', () => {
    const db = createDb(':memory:');
    const a = createUser(db, 'gym@query.test').id;
    const res = runUserQuery(db, a, 'SELECT COUNT(*) AS n FROM exercise_library');
    expect(res.error).toBeUndefined();
    expect(res.rows[0].n).toBeGreaterThan(0);
  });
});
