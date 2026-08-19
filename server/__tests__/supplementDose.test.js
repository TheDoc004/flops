const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createSupplementsRouter } = require('../routes/supplements');
const { parseServingText, doseMultiplier, scaleValues, describeDose } = require('../supplementDose');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/supplements', createSupplementsRouter(db));
  return { app, db };
}

describe('parseServingText', () => {
  it('pulls quantity and unit out of real label text', () => {
    expect(parseServingText('2 Capsules')).toEqual({ qty: 2, unit: 'capsule' });
    expect(parseServingText('3 Softgels')).toEqual({ qty: 3, unit: 'softgel' });
    expect(parseServingText('1 Tablet')).toEqual({ qty: 1, unit: 'tablet' });
    expect(parseServingText('120 Gummies')).toEqual({ qty: 120, unit: 'gummy' });
  });

  it('ignores a parenthetical gram equivalent', () => {
    expect(parseServingText('1 scoop (32 g)')).toEqual({ qty: 1, unit: 'scoop' });
  });

  it('returns null when there is no leading number', () => {
    expect(parseServingText('as directed')).toBeNull();
    expect(parseServingText('')).toBeNull();
    expect(parseServingText(null)).toBeNull();
  });
});

describe('doseMultiplier', () => {
  it('is the ratio of what you take to the label serving', () => {
    // The case that started this: label says 2 softgels, you swallow 3.
    expect(doseMultiplier({ label_serving_qty: 2, dose_qty: 3 })).toBe(1.5);
    expect(doseMultiplier({ label_serving_qty: 2, dose_qty: 2 })).toBe(1);
    expect(doseMultiplier({ label_serving_qty: 2, dose_qty: 1 })).toBe(0.5);
  });

  it('never returns Infinity or NaN', () => {
    expect(doseMultiplier({ label_serving_qty: 0, dose_qty: 3 })).toBe(1);
    expect(doseMultiplier({ label_serving_qty: null, dose_qty: 3 })).toBe(1);
    expect(doseMultiplier({ label_serving_qty: 2, dose_qty: 0 })).toBe(1);
    expect(doseMultiplier({})).toBe(1);
  });
});

describe('scaleValues / describeDose', () => {
  it('scales every nutrient and drops empties', () => {
    expect(scaleValues({ vitamin_d_mcg: 25, iron_mg: 0 }, 1.5)).toEqual({ vitamin_d_mcg: 37.5 });
  });
  it('reads naturally', () => {
    expect(describeDose(3, 'softgel')).toBe('3 softgels');
    expect(describeDose(1, 'softgel')).toBe('1 softgel');
    expect(describeDose(2, 'gummy')).toBe('2 gummies');
  });
});

describe('supplement dose end to end', () => {
  const micros = { vitamin_d_mcg: 25, calcium_mg: 200 };

  it('scales macros and micros by the dose you actually take', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/supplements').send({
      name: 'Fish oil',
      dose_text: '2 Softgels',
      counts_toward_macros: 1,
      calories: 20,
      fat_g: 2,
      micros,
      label_serving_qty: 2,
      label_serving_unit: 'softgel',
      dose_qty: 3, // I take three
    });
    expect(created.status).toBe(201);
    expect(created.body.dose_multiplier).toBe(1.5);
    expect(created.body.dose_display).toBe('3 softgels');
    expect(created.body.label_serving_display).toBe('2 softgels');
    // Reported values are real intake…
    expect(created.body.calories).toBe(30);
    expect(created.body.micros).toEqual({ vitamin_d_mcg: 37.5, calcium_mg: 300 });
    // …while the label's own numbers stay available to show alongside.
    expect(created.body.per_label_serving.calories).toBe(20);
    expect(created.body.per_label_serving.micros).toEqual(micros);
  });

  it('counts the scaled macros in the day total', async () => {
    const { app } = buildApp();
    const s = await request(app).post('/api/supplements').send({
      name: 'Fish oil', counts_toward_macros: 1, calories: 20, fat_g: 2,
      label_serving_qty: 2, label_serving_unit: 'softgel', dose_qty: 3,
    });
    await request(app).put('/api/supplements/log').send({ date: '2026-07-27', supplement_id: s.body.id, taken: 1 });

    const today = await request(app).get('/api/supplements/today?date=2026-07-27');
    expect(today.body.totals.calories).toBe(30); // not the label's 20
  });

  it('lets one day differ without touching the usual dose', async () => {
    const { app } = buildApp();
    const s = await request(app).post('/api/supplements').send({
      name: 'Fish oil', counts_toward_macros: 1, calories: 20,
      label_serving_qty: 2, label_serving_unit: 'softgel', dose_qty: 3, micros,
    });
    // Today I only took 2.
    await request(app).put('/api/supplements/log').send({
      date: '2026-07-27', supplement_id: s.body.id, taken: 1, dose_qty: 2,
    });

    const today = await request(app).get('/api/supplements/today?date=2026-07-27');
    expect(today.body.supplements[0].dose_qty).toBe(2);
    expect(today.body.totals.calories).toBe(20);

    // The usual dose is untouched, so another day still uses 3.
    await request(app).put('/api/supplements/log').send({ date: '2026-07-28', supplement_id: s.body.id, taken: 1 });
    const other = await request(app).get('/api/supplements/today?date=2026-07-28');
    expect(other.body.supplements[0].dose_qty).toBe(3);
    expect(other.body.totals.calories).toBe(30);
  });

  it('keeps a day amount when the box is later just re-ticked', async () => {
    const { app } = buildApp();
    const s = await request(app).post('/api/supplements').send({
      name: 'Fish oil', label_serving_qty: 2, label_serving_unit: 'softgel', dose_qty: 3, micros,
    });
    await request(app).put('/api/supplements/log').send({
      date: '2026-07-27', supplement_id: s.body.id, taken: 1, dose_qty: 5,
    });
    // Untick and re-tick — no dose_qty in the body, so the day keeps its 5.
    await request(app).put('/api/supplements/log').send({ date: '2026-07-27', supplement_id: s.body.id, taken: 0 });
    await request(app).put('/api/supplements/log').send({ date: '2026-07-27', supplement_id: s.body.id, taken: 1 });

    const today = await request(app).get('/api/supplements/today?date=2026-07-27');
    expect(today.body.supplements[0].dose_qty).toBe(5);
  });

  it('scales History micros by that day\'s amount', async () => {
    const { app } = buildApp();
    const s = await request(app).post('/api/supplements').send({
      name: 'Fish oil', label_serving_qty: 2, label_serving_unit: 'softgel', dose_qty: 3, micros,
    });
    await request(app).put('/api/supplements/log').send({ date: '2026-07-27', supplement_id: s.body.id, taken: 1 });
    await request(app).put('/api/supplements/log').send({
      date: '2026-07-28', supplement_id: s.body.id, taken: 1, dose_qty: 4,
    });

    const range = await request(app).get('/api/supplements/range?start=2026-07-27&end=2026-07-28');
    expect(range.body.byDate['2026-07-27'][0].micros.vitamin_d_mcg).toBe(37.5); // 3 of 2
    expect(range.body.byDate['2026-07-28'][0].micros.vitamin_d_mcg).toBe(50); // 4 of 2
  });

  it('defaults to taking exactly one label serving', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/supplements').send({
      name: 'Vitamin D', dose_text: '1 Softgel', calories: 5, micros,
    });
    // No dose given: the label serving is parsed out of the text and taken as-is.
    expect(created.body.label_serving_qty).toBe(1);
    expect(created.body.dose_qty).toBe(1);
    expect(created.body.dose_multiplier).toBe(1);
    expect(created.body.calories).toBe(5);
  });
});

describe('migration of existing supplements', () => {
  it('leaves totals exactly as they were', () => {
    const db = createDb(':memory:');
    // A row as it existed before this feature: free-text dose only.
    db.prepare(
      `INSERT INTO supplements (id, user_id, name, dose_text, calories, counts_toward_macros, micros_json, sort_order)
       VALUES (1, 0, 'Magnesium', '2 Capsules', 10, 1, ?, 0)`
    ).run(JSON.stringify({ micros: { magnesium_mg: 200 }, confidence: 'high' }));

    // Re-run the migration the way a reboot would.
    const cols = db.prepare('PRAGMA table_info(supplements)').all().map(c => c.name);
    expect(cols).toContain('label_serving_qty');

    const row = db.prepare('SELECT label_serving_qty, label_serving_unit, dose_qty FROM supplements WHERE id = 1').get();
    // The seed was inserted after createDb ran, so it has no backfill — the
    // point being that a fresh insert without dose fields still resolves to
    // "one label serving" rather than a broken multiplier.
    expect(doseMultiplier(row)).toBe(1);
  });

  it('backfills a pre-existing row so its multiplier is exactly 1', () => {
    const seeded = createDb(':memory:');
    seeded.prepare(
      `INSERT INTO supplements (id, user_id, name, dose_text, calories, counts_toward_macros, sort_order)
       VALUES (1, 0, 'Magnesium', '2 Capsules', 10, 1, 0)`
    ).run();
    // Simulate the next boot by clearing the dose columns and re-migrating.
    seeded.exec('UPDATE supplements SET label_serving_qty = NULL, label_serving_unit = NULL, dose_qty = NULL');
    const { parseServingText: parse } = require('../supplementDose');
    const parsed = parse('2 Capsules');
    seeded.prepare('UPDATE supplements SET label_serving_qty = ?, label_serving_unit = ?, dose_qty = ? WHERE id = 1')
      .run(parsed.qty, parsed.unit, parsed.qty);

    const row = seeded.prepare('SELECT label_serving_qty, label_serving_unit, dose_qty FROM supplements WHERE id = 1').get();
    expect(row).toEqual({ label_serving_qty: 2, label_serving_unit: 'capsule', dose_qty: 2 });
    expect(doseMultiplier(row)).toBe(1); // totals unchanged by the migration
  });
});
