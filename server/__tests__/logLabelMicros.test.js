const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLogRouter } = require('../routes/log');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');

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

/** Any AI call would go through global fetch — so we can prove none happened. */
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

const microsOf = (db, id) => JSON.parse(db.prepare('SELECT micros_json FROM log_entries WHERE id = ?').get(id).micros_json);

describe('log-time micros prefer product labels', () => {
  it('uses stored label values and never calls the AI', async () => {
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

    const blob = microsOf(db, res.body.id);
    // Two servings of the label values — not the 99 the mocked AI would return.
    expect(blob.micros).toEqual({ sodium_mg: 320, iron_mg: 9 });
    expect(blob.confidence).toBe('high');
    expect(blob.notes).toBe('From product labels');
    expect(aiCalls).toBe(0);
  });

  it('estimates only the ingredients without label data, and merges', async () => {
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

    const blob = microsOf(db, res.body.id);
    // Iron came off the label (4.5), beating the AI's 99; zinc only the AI had.
    expect(blob.micros.iron_mg).toBe(4.5);
    expect(blob.micros.zinc_mg).toBe(7);
    expect(blob.confidence).toBe('medium'); // partly estimated
    expect(blob.notes).toMatch(/1 of 2 ingredients from product labels/);
    expect(aiCalls).toBe(1);
  });

  it('falls back to pure estimation when nothing carries label micros', async () => {
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
    expect(microsOf(db, res.body.id).micros.iron_mg).toBe(99); // the estimate
    expect(aiCalls).toBe(1);
  });
});
