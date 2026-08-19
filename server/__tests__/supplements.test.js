const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createSupplementsRouter } = require('../routes/supplements');

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

describe('/api/supplements — micronutrients', () => {
  it('POST stores micros and returns them as a parsed object', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements').send({
      user_id: 0,
      name: 'Multivitamin',
      dose_text: '1 tablet',
      micros: { vitamin_d_mcg: 25, vitamin_b12_mcg: 100, zinc_mg: 15 },
    });
    expect(res.status).toBe(201);
    expect(res.body.micros).toEqual({ vitamin_d_mcg: 25, vitamin_b12_mcg: 100, zinc_mg: 15 });
    // Raw storage column is not leaked to the API.
    expect(res.body.micros_json).toBeUndefined();
  });

  it('drops unknown keys and all-zero micros (stores null)', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements').send({
      user_id: 0,
      name: 'Creatine',
      micros: { not_a_nutrient: 999, iron_mg: 0 },
    });
    expect(res.status).toBe(201);
    expect(res.body.micros).toBeNull();
  });

  it('PUT updates micros', async () => {
    const { app } = buildApp();
    const { body: created } = await request(app).post('/api/supplements').send({
      user_id: 0,
      name: 'Fish oil',
      micros: { vitamin_d_mcg: 10 },
    });
    const res = await request(app).put(`/api/supplements/${created.id}`).send({
      user_id: 0,
      name: 'Fish oil',
      micros: { vitamin_d_mcg: 12, calcium_mg: 200 },
    });
    expect(res.status).toBe(200);
    expect(res.body.micros).toEqual({ vitamin_d_mcg: 12, calcium_mg: 200 });
  });

  it('GET /today includes each supplement\'s micros', async () => {
    const { app } = buildApp();
    await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Multivitamin', micros: { iron_mg: 8 },
    });
    const res = await request(app).get('/api/supplements/today?user_id=0&date=2026-07-25');
    expect(res.status).toBe(200);
    expect(res.body.supplements[0].micros).toEqual({ iron_mg: 8 });
  });

  it('GET /range returns taken supplements with micros grouped by date', async () => {
    const { app } = buildApp();
    const { body: vit } = await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Vitamin D', micros: { vitamin_d_mcg: 25 },
    });
    const { body: creatine } = await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Creatine', // no micros
    });

    // Take the vitamin on one day; the macro-only creatine on another.
    await request(app).put('/api/supplements/log').send({ user_id: 0, date: '2026-07-24', supplement_id: vit.id, taken: 1 });
    await request(app).put('/api/supplements/log').send({ user_id: 0, date: '2026-07-25', supplement_id: creatine.id, taken: 1 });

    const res = await request(app).get('/api/supplements/range?user_id=0&start=2026-07-20&end=2026-07-26');
    expect(res.status).toBe(200);
    expect(res.body.byDate['2026-07-24']).toEqual([
      {
        id: vit.id, name: 'Vitamin D', micros: { vitamin_d_mcg: 25 },
        counts_toward_macros: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      },
    ]);
    // A taken supplement with neither micros nor counted macros contributes nothing.
    expect(res.body.byDate['2026-07-25']).toBeUndefined();
  });

  it('GET /range includes macro-counting supplements, dose-scaled', async () => {
    const { app } = buildApp();
    // Label serving = 1 scoop at 120 cal / 25g protein; the user takes 2 scoops.
    const { body: shake } = await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Whey', counts_toward_macros: 1,
      calories: 120, protein_g: 25, carbs_g: 3, fat_g: 1.5,
      label_serving_qty: 1, label_serving_unit: 'scoop', dose_qty: 2,
    });
    await request(app).put('/api/supplements/log').send({ user_id: 0, date: '2026-07-24', supplement_id: shake.id, taken: 1 });

    const res = await request(app).get('/api/supplements/range?user_id=0&start=2026-07-20&end=2026-07-26');
    expect(res.status).toBe(200);
    expect(res.body.byDate['2026-07-24']).toEqual([
      {
        id: shake.id, name: 'Whey', micros: null, counts_toward_macros: 1,
        calories: 240, protein_g: 50, carbs_g: 6, fat_g: 3,
      },
    ]);
  });

  it('GET /range scales macros by that day\'s amount, not the usual dose', async () => {
    const { app } = buildApp();
    const { body: shake } = await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Whey', counts_toward_macros: 1, calories: 100, protein_g: 20,
      label_serving_qty: 1, label_serving_unit: 'scoop', dose_qty: 1,
    });
    await request(app).put('/api/supplements/log').send({
      user_id: 0, date: '2026-07-24', supplement_id: shake.id, taken: 1, dose_qty: 3,
    });

    const res = await request(app).get('/api/supplements/range?user_id=0&start=2026-07-20&end=2026-07-26');
    const row = res.body.byDate['2026-07-24'][0];
    expect(row.calories).toBe(300);
    expect(row.protein_g).toBe(60);
  });

  it('GET /range excludes days where the supplement was untaken', async () => {
    const { app } = buildApp();
    const { body: vit } = await request(app).post('/api/supplements').send({
      user_id: 0, name: 'Vitamin C', micros: { vitamin_c_mg: 90 },
    });
    await request(app).put('/api/supplements/log').send({ user_id: 0, date: '2026-07-24', supplement_id: vit.id, taken: 1 });
    await request(app).put('/api/supplements/log').send({ user_id: 0, date: '2026-07-24', supplement_id: vit.id, taken: 0 });

    const res = await request(app).get('/api/supplements/range?user_id=0&start=2026-07-20&end=2026-07-26');
    expect(res.body.byDate['2026-07-24']).toBeUndefined();
  });
});

describe('/api/supplements/scan-label', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete global.fetch;
  });

  it('400 when no image body is sent', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements/scan-label').set('Content-Type', 'image/jpeg').send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it('503 when no AI provider is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_PROVIDER;
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements/scan-label').set('Content-Type', 'image/jpeg').send(Buffer.from([1, 2, 3]));
    expect(res.status).toBe(503);
  });

  it('returns the shaped label suggestion from the vision AI', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          name: 'Daily Multi', dose_text: '1 tablet',
          micros: { vitamin_d_mcg: 25, iron_mg: 8, junk: 5 }, confidence: 'high',
        }) } }],
      }),
    }));
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements/scan-label').set('Content-Type', 'image/jpeg').send(Buffer.from([1, 2, 3]));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Daily Multi');
    expect(res.body.dose_text).toBe('1 tablet');
    expect(res.body.micros).toEqual({ vitamin_d_mcg: 25, iron_mg: 8 });
  });
});
