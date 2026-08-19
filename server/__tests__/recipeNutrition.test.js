const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createRecipesRouter } = require('../routes/recipes');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/recipes', createRecipesRouter(db));
  return { app, db };
}

/** A weighed library ingredient; `micros` mirrors a barcode-captured label. */
function addIngredient(db, { id, name, calories = 100, protein = 5, carbs = 20, fat = 1, micros = null }) {
  db.prepare(
    `INSERT INTO label_ingredients (id, user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
       tracking_type, grams_per_serving, micros_json)
     VALUES (?, 1, ?, '100 g', ?, ?, ?, ?, 'weight', 100, ?)`
  ).run(
    id, name, calories, protein, carbs, fat,
    // Stored exactly as a barcode import writes it: a blob, not a flat map.
    micros ? JSON.stringify({ micros, confidence: 'high', notes: 'From product label' }) : null
  );
}

function addRecipe(db, ingredients) {
  return db.prepare(
    `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, ingredients)
     VALUES (1, 'Test meal', '1 meal', 0, 0, 0, 0, ?)`
  ).run(JSON.stringify(ingredients)).lastInsertRowid;
}

const slot = (slot_id, label, ids, amount = '100') => ({
  kind: 'slot', slot_id, label, amount, unit: 'g', option_label_ingredient_ids: ids,
});

/** Any AI estimate goes out over fetch — so we can count whether one happened. */
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
        choices: [{ message: { content: JSON.stringify({ micros: { iron_mg: 4 }, confidence: 'low' }) } }],
      }),
    };
  });
});
afterEach(() => { delete global.fetch; });

describe('GET /api/recipes/:id/nutrition', () => {
  it('returns the rows and macros for the default ingredients', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Oats', calories: 380, protein: 13, carbs: 67, fat: 7 });
    addIngredient(db, { id: 2, name: 'Milk', calories: 50, protein: 3, carbs: 5, fat: 2 });
    const id = addRecipe(db, [slot('s1', 'Oats', [1], '50'), slot('s2', 'Milk', [2], '200')]);

    const res = await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(res.status).toBe(200);
    expect(res.body.ingredientsKnown).toBe(true);
    expect(res.body.rows.map(r => [r.name, r.amount])).toEqual([['Oats', 50], ['Milk', 200]]);
    // 50g of a per-100g item is half; 200g is double.
    expect(res.body.macros.calories).toBeCloseTo(380 * 0.5 + 50 * 2, 1);
    expect(res.body.macros.protein_g).toBeCloseTo(13 * 0.5 + 3 * 2, 1);
  });

  /* Defaults mean the FIRST option of each slot — substitutes are a log-time
     choice, and this endpoint deliberately describes the recipe as saved. */
  it('resolves each slot to its default option, ignoring substitutes', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Bread', calories: 250 });
    addIngredient(db, { id: 2, name: 'Sweet potato', calories: 86 });
    const id = addRecipe(db, [slot('s1', 'Toast', [1, 2], '100')]);

    const res = await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].name).toBe('Bread');
    expect(res.body.macros.calories).toBeCloseTo(250, 1);
  });

  it('uses label micros and makes no AI call when every ingredient has them', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Cereal', micros: { iron_mg: 8, calcium_mg: 200 } });
    const id = addRecipe(db, [slot('s1', 'Cereal', [1], '100')]);

    const res = await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(aiCalls).toBe(0);
    expect(res.body.micros.confidence).toBe('high');
    expect(res.body.micros.micros.iron_mg).toBeCloseTo(8, 1);
  });

  it('caches the estimate so a second request costs no AI call', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Rice' }); // no label micros -> needs the AI
    const id = addRecipe(db, [slot('s1', 'Rice', [1], '100')]);

    await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(aiCalls).toBe(1);
    const res = await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(aiCalls).toBe(1); // served from cache
    expect(res.body.micros.micros.iron_mg).toBeCloseTo(4, 1);
  });

  /* The fingerprint is what makes the cache safe: change the recipe and the
     stored estimate no longer describes it, so it must be recomputed. */
  it('recomputes after the recipe is edited', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Rice' });
    const id = addRecipe(db, [slot('s1', 'Rice', [1], '100')]);

    await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(aiCalls).toBe(1);
    db.prepare('UPDATE recipes SET ingredients = ? WHERE id = ?')
      .run(JSON.stringify([slot('s1', 'Rice', [1], '250')]), id);
    await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(aiCalls).toBe(2);
  });

  it('reports when a recipe has no computable ingredients', async () => {
    const { app, db } = buildApp();
    const id = addRecipe(db, []);
    const res = await request(app).get(`/api/recipes/${id}/nutrition`);
    expect(res.body).toEqual({ rows: [], macros: null, micros: null, ingredientsKnown: false });
    expect(aiCalls).toBe(0);
  });

  it('404s for an unknown recipe', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/recipes/9999/nutrition')).status).toBe(404);
  });

  it('keeps the cached blob out of the recipe list payload', async () => {
    const { app, db } = buildApp();
    addIngredient(db, { id: 1, name: 'Rice' });
    const id = addRecipe(db, [slot('s1', 'Rice', [1], '100')]);
    await request(app).get(`/api/recipes/${id}/nutrition`);

    const list = await request(app).get('/api/recipes');
    expect(list.body[0]).not.toHaveProperty('micros_json');
    expect(list.body[0]).not.toHaveProperty('micros_fingerprint');
  });
});
