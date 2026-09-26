const request = require('supertest');
const { wrapWithAuth, createUser } = require('./helpers');
const { createSupplementsRouter } = require('../routes/supplements');
const { createDb } = require('../db');
const { parseMicrosFlat, buildMicrosBlob } = require('../microNutrients');
const reads = require('../mcp/reads');
const { mapIngredientRow } = require('../dsldService');

describe('fish oil → day omega-3 totals', () => {
  it('parseMicrosFlat accepts nested and flat blobs', () => {
    expect(parseMicrosFlat(JSON.stringify({ micros: { omega3_epa_mg: 360 } }))).toEqual({
      omega3_epa_mg: 360,
    });
    expect(parseMicrosFlat(JSON.stringify({ omega3_dha_mg: 240, garbage: 9 }))).toEqual({
      omega3_dha_mg: 240,
    });
    expect(parseMicrosFlat(null)).toBeNull();
    expect(parseMicrosFlat(JSON.stringify({ micros: { omega3_epa_mg: 0 } }))).toBeNull();
  });

  it('DSLD maps EPA ethyl-ester style names after parenthetical strip', () => {
    expect(
      mapIngredientRow({
        ingredientGroup: 'EPA (as EE)',
        name: 'Eicosapentaenoic Acid',
        quantity: [{ quantity: 360, unit: 'mg' }],
      })
    ).toMatchObject({ key: 'omega3_epa_mg', value: 360 });
  });

  it('taken fish oil with EPA/DHA appears in /range and get_micronutrient_totals', async () => {
    const db = createDb(':memory:');
    const userId = createUser(db, 'fishoil@test').id;
    const app = wrapWithAuth(db, '/api/supplements', createSupplementsRouter(db));

    const blob = buildMicrosBlob(
      { omega3_epa_mg: 360, omega3_dha_mg: 240 },
      { confidence: 'high', notes: 'From supplement label' }
    );
    const ins = db
      .prepare(
        `INSERT INTO supplements (
           user_id, name, dose_text, calories, protein_g, carbs_g, fat_g,
           counts_toward_macros, micros_json, sort_order,
           label_serving_qty, label_serving_unit, dose_qty
         ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, 0, 2, 'softgel', 2)`
      )
      .run(userId, 'Fish Oil', '2 softgels', JSON.stringify(blob));
    const supplementId = ins.lastInsertRowid;

    db.prepare(
      `INSERT INTO supplement_log (user_id, date, supplement_id, taken, dose_qty)
       VALUES (?, '2026-09-26', ?, 1, NULL)`
    ).run(userId, supplementId);

    const range = await request(app).get('/api/supplements/range?start=2026-09-26&end=2026-09-26');
    expect(range.status).toBe(200);
    expect(range.body.byDate['2026-09-26']).toEqual([
      expect.objectContaining({
        id: supplementId,
        name: 'Fish Oil',
        micros: { omega3_epa_mg: 360, omega3_dha_mg: 240 },
      }),
    ]);

    const totals = reads.getMicronutrientTotals(db, userId, '2026-09-26', '2026-09-26', {
      includeSupplements: true,
    });
    expect(totals.totals.omega3_epa_mg).toBe(360);
    expect(totals.totals.omega3_dha_mg).toBe(240);
    expect(totals.supplement_days_with_micros).toBe(1);
    expect(totals.pct_of_daily_target.omega3_epa_mg).toBe(144);
  });

  it('taken fish oil with null micros_json contributes nothing to day totals', () => {
    const db = createDb(':memory:');
    const userId = createUser(db, 'emptyoil@test').id;
    const ins = db
      .prepare(
        `INSERT INTO supplements (
           user_id, name, dose_text, calories, protein_g, carbs_g, fat_g,
           counts_toward_macros, micros_json, sort_order,
           label_serving_qty, label_serving_unit, dose_qty
         ) VALUES (?, 'Fish Oil', '2 softgels', 0, 0, 0, 0, 0, NULL, 0, 1, 'softgel', 1)`
      )
      .run(userId);
    db.prepare(
      `INSERT INTO supplement_log (user_id, date, supplement_id, taken)
       VALUES (?, '2026-09-26', ?, 1)`
    ).run(userId, ins.lastInsertRowid);

    const totals = reads.getMicronutrientTotals(db, userId, '2026-09-26', '2026-09-26');
    expect(totals.totals.omega3_epa_mg || 0).toBe(0);
    expect(totals.supplement_days_with_micros).toBe(0);
  });

  it('legacy flat micros_json on a taken supplement still fills omega-3 totals', () => {
    const db = createDb(':memory:');
    const userId = createUser(db, 'flatoil@test').id;
    const ins = db
      .prepare(
        `INSERT INTO supplements (
           user_id, name, dose_text, calories, protein_g, carbs_g, fat_g,
           counts_toward_macros, micros_json, sort_order,
           label_serving_qty, label_serving_unit, dose_qty
         ) VALUES (?, 'Fish Oil', '1 softgel', 0, 0, 0, 0, 0, ?, 0, 1, 'softgel', 1)`
      )
      .run(userId, JSON.stringify({ omega3_epa_mg: 180, omega3_dha_mg: 120 }));
    db.prepare(
      `INSERT INTO supplement_log (user_id, date, supplement_id, taken)
       VALUES (?, '2026-09-26', ?, 1)`
    ).run(userId, ins.lastInsertRowid);

    const totals = reads.getMicronutrientTotals(db, userId, '2026-09-26', '2026-09-26');
    expect(totals.totals.omega3_epa_mg).toBe(180);
    expect(totals.totals.omega3_dha_mg).toBe(120);
  });
});
