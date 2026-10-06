const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLogRouter } = require('../routes/log');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');
const { resolveEntryMicros } = require('../entryMicros');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/log', createLogRouter(db));
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  return { app, db };
}

/** Any AI call would go through global fetch — Part B must never call it on log. */
let aiCalls = 0;
beforeEach(() => {
  aiCalls = 0;
  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'test';
  global.fetch = jest.fn(async () => {
    aiCalls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ micros: { iron_mg: 99, zinc_mg: 7 }, confidence: 'low' }) } }],
      }),
    };
  });
});
afterEach(() => {
  delete global.fetch;
});

async function createIngredient(app, body) {
  const res = await request(app).post('/api/label-ingredients').send({
    user_id: 0,
    serving_size_text: '37 g',
    grams_per_serving: 37,
    calories: 140,
    protein_g: 3,
    carbs_g: 29,
    fat_g: 2,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Part B: meal micros live from ingredient library', () => {
  it('does not freeze micros_json on log; GET returns live-scaled library values', async () => {
    const { app, db } = buildApp();
    const ing = await createIngredient(app, {
      name: 'Cheerios',
      barcode: '016000275270',
      micros: { iron_mg: 4.5, sodium_mg: 160 },
    });

    const res = await request(app).post('/api/log/custom').send({
      date: '2026-07-27',
      name: 'Cereal',
      calories: 140,
      protein_g: 3,
      carbs_g: 29,
      fat_g: 2,
      ingredients: [{ name: 'Cheerios', amount: 74, unit: 'g', label_ingredient_id: ing.id }],
    });
    expect(res.status).toBe(201);
    expect(aiCalls).toBe(0);

    // DB column stays null (no freeze).
    const raw = db.prepare('SELECT micros_json FROM log_entries WHERE id = ?').get(res.body.id);
    expect(raw.micros_json).toBeNull();

    // Response overlays live-derived blob (2 servings of label values).
    const blob = JSON.parse(res.body.micros_json);
    expect(blob.micros).toEqual({ sodium_mg: 320, iron_mg: 9 });
    expect(blob.confidence).toBe('high');
    expect(blob.notes).toMatch(/Live from ingredient library/);

    const get = await request(app).get('/api/log?date=2026-07-27');
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body[0].micros_json).micros.iron_mg).toBe(9);
  });

  it('partial coverage: only library micros, no AI merge on write', async () => {
    const { app, db } = buildApp();
    const ing = await createIngredient(app, {
      name: 'Cheerios',
      micros: { iron_mg: 4.5 },
    });

    const res = await request(app).post('/api/log/custom').send({
      date: '2026-07-27',
      name: 'Cereal and fruit',
      calories: 200,
      protein_g: 4,
      carbs_g: 40,
      fat_g: 2,
      ingredients: [
        { name: 'Cheerios', amount: 37, unit: 'g', label_ingredient_id: ing.id },
        { name: 'a handful of blueberries' },
      ],
    });
    expect(res.status).toBe(201);
    expect(aiCalls).toBe(0);
    expect(db.prepare('SELECT micros_json FROM log_entries WHERE id = ?').get(res.body.id).micros_json).toBeNull();

    const blob = JSON.parse(res.body.micros_json);
    expect(blob.micros.iron_mg).toBe(4.5);
    expect(blob.micros.zinc_mg).toBeUndefined();
    expect(blob.confidence).toBe('medium'); // partial → not high
    expect(blob.notes).toMatch(/Not counted.*blueberries/);
    expect(blob.missing_ingredients).toEqual(['a handful of blueberries']);
  });

  it('falls back to legacy frozen meal blob when library has nothing', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/log/custom').send({
      date: '2026-07-27',
      name: 'Mystery bowl',
      calories: 300,
      protein_g: 10,
      carbs_g: 40,
      fat_g: 5,
      ingredients: [{ name: 'leftovers' }],
    });
    expect(res.status).toBe(201);
    expect(aiCalls).toBe(0);
    expect(res.body.micros_json).toBeNull();

    // Simulate a pre-Part-B frozen AI blob still on the row.
    db.prepare('UPDATE log_entries SET micros_json = ? WHERE id = ?').run(
      JSON.stringify({ micros: { iron_mg: 99 }, confidence: 'low', notes: 'legacy' }),
      res.body.id
    );
    const resolved = resolveEntryMicros(db, 0, db.prepare('SELECT * FROM log_entries WHERE id = ?').get(res.body.id));
    expect(resolved.source).toBe('frozen');
    expect(resolved.blob.micros.iron_mg).toBe(99);
  });

  it('picks up ingredient micros backfilled after the meal was logged', async () => {
    const { app, db } = buildApp();
    const ing = await createIngredient(app, {
      name: 'Banana',
      serving_size_text: '100 g',
      grams_per_serving: 100,
      micros: null,
    });
    const res = await request(app).post('/api/log/custom').send({
      date: '2026-07-27',
      name: 'Snack',
      calories: 89,
      protein_g: 1,
      carbs_g: 23,
      fat_g: 0,
      ingredients: [{ name: 'Banana', amount: 100, unit: 'g', label_ingredient_id: ing.id }],
    });
    expect(res.status).toBe(201);
    expect(res.body.micros_json).toBeNull();

    db.prepare('UPDATE label_ingredients SET micros_json = ? WHERE id = ?').run(
      JSON.stringify({
        micros: { potassium_mg: 358, vitamin_c_mg: 9 },
        confidence: 'medium',
        notes: 'USDA',
      }),
      ing.id
    );

    const get = await request(app).get('/api/log?date=2026-07-27');
    const blob = JSON.parse(get.body[0].micros_json);
    expect(blob.micros.potassium_mg).toBe(358);
    expect(blob.confidence).toBe('medium');
  });
});
