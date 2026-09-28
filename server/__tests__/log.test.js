const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createRecipesRouter } = require('../routes/recipes');
const { createLogRouter } = require('../routes/log');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');
const { buildTestApp, authHeader, createUser } = require('./helpers');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/log', createLogRouter(db));
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  return app;
}

async function seedRecipe(app) {
  const res = await request(app).post('/api/recipes').send({
    name: 'Oatmeal', serving_size: '1 cup', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
  });
  return res.body;
}

describe('GET /api/log?date=', () => {
  it('returns empty array for a date with no entries', async () => {
    const res = await request(buildApp()).get('/api/log?date=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns entries with joined recipe fields', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1.5 });
    const res = await request(app).get('/api/log?date=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const e = res.body[0];
    expect(e.recipe_name).toBe('Oatmeal');
    expect(e.servings).toBe(1.5);
    expect(e.recipe_calories).toBe(150);
    expect(e.recipe_protein_g).toBe(5);
    expect(e.recipe_carbs_g).toBe(27);
    expect(e.recipe_fat_g).toBe(3);
  });

  it('does not return entries for a different date', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-08', servings: 1 });
    const res = await request(app).get('/api/log?date=2026-04-09');
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/log?start=&end=', () => {
  it('returns all entries in the date range', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-07', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 2 });
    const res = await request(app).get('/api/log?start=2026-04-07&end=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('excludes entries outside the range', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-06', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).get('/api/log?start=2026-04-07&end=2026-04-09');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe('2026-04-09');
  });
});

describe('GET /api/log/days', () => {
  it('returns day totals grouped by date', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-07', servings: 2 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-07', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });

    const res = await request(app).get('/api/log/days?limit=10&offset=0');
    expect(res.status).toBe(200);
    // sorted DESC by date
    expect(res.body[0].date).toBe('2026-04-09');
    expect(res.body[1].date).toBe('2026-04-07');
    const d = res.body.find(x => x.date === '2026-04-07');
    expect(Math.round(d.calories)).toBe(150 * 3);
    expect(d.entries_count).toBe(2);
  });

  it('paginates with limit/offset', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-07', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-08', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });

    const first = await request(app).get('/api/log/days?limit=2&offset=0');
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(2);
    expect(first.body[0].date).toBe('2026-04-09');
    expect(first.body[1].date).toBe('2026-04-08');

    const second = await request(app).get('/api/log/days?limit=2&offset=2');
    expect(second.status).toBe(200);
    expect(second.body[0].date).toBe('2026-04-07');
  });
});

describe('GET /api/log (no params)', () => {
  it('returns 400', async () => {
    const res = await request(buildApp()).get('/api/log');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/log', () => {
  it('creates an entry and returns it with joined recipe data', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const res = await request(app)
      .post('/api/log')
      .send({ recipe_id: recipe.id, date: '2026-04-09', time_min: 8 * 60 + 30, servings: 2 });
    expect(res.status).toBe(201);
    expect(res.body.recipe_name).toBe('Oatmeal');
    expect(res.body.servings).toBe(2);
    expect(res.body.id).toBeDefined();
    expect(res.body.time_min).toBe(8 * 60 + 30);
  });

  it('stores optional notes', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const res = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1, notes: 'post-workout' });
    expect(res.body.notes).toBe('post-workout');
  });

  it('returns 400 when recipe_id is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ date: '2026-04-09', servings: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 1, servings: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when servings is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 1, date: '2026-04-09' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when recipe does not exist', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 999, date: '2026-04-09', servings: 1 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/log/quick-food', () => {
  it('creates (or reuses) a quick food recipe and logs by grams', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/log/quick-food').send({
      date: '2026-04-09',
      name: 'Banana',
      amount: 120,
      unit: 'g',
      calories_100g: 89,
      protein_g_100g: 1.1,
      carbs_g_100g: 22.8,
      fat_g_100g: 0.3,
    });
    expect(res.status).toBe(201);
    expect(res.body.recipe_name).toBe('Banana');
    // servings should be 1.2 of 100g
    expect(Number(res.body.servings)).toBeCloseTo(1.2, 5);
    expect(res.body.recipe_is_quick_food).toBe(1);
  });

  it('logs by ounces', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/log/quick-food').send({
      date: '2026-04-09',
      name: 'Oats (dry)',
      amount: 2,
      unit: 'oz',
      calories_100g: 389,
      protein_g_100g: 16.9,
      carbs_g_100g: 66.3,
      fat_g_100g: 6.9,
    });
    expect(res.status).toBe(201);
    expect(res.body.recipe_name).toMatch(/Oats/i);
    expect(res.body.recipe_is_quick_food).toBe(1);
    expect(Number(res.body.servings)).toBeGreaterThan(0.5);
  });
});

describe('DELETE /api/log/:id', () => {
  it('deletes an entry and returns 204', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).delete(`/api/log/${entry.id}`);
    expect(res.status).toBe(204);
    const list = await request(app).get('/api/log?date=2026-04-09');
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).delete('/api/log/999');
    expect(res.status).toBe(404);
  });
});

describe('limited-use templates — servings consume and restore uses', () => {
  async function seedMealPrep(app, uses = 4) {
    const res = await request(app).post('/api/recipes').send({
      name: 'Chicken & Rice Prep', serving_size: `1 of ${uses} meal-prep servings`,
      calories: 500, protein_g: 45, carbs_g: 55, fat_g: 10,
      recipe_kind: 'limited', remaining_uses: uses, max_uses: uses,
    });
    return res.body;
  }
  const getRecipe = (app, id) => request(app).get(`/api/recipes/${id}`).then(r => r.body);

  it('logging N servings consumes N uses', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 4);
    await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 2 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(2);
  });

  it('rejects logging more servings than remain (409), untouched count', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 2);
    const res = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 3 });
    expect(res.status).toBe(409);
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(2);
  });

  it('deleting a logged serving restores the count (undo semantics)', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 4);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 1 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(3);
    await request(app).delete(`/api/log/${entry.id}`);
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(4);
  });

  it('deleting the last serving un-archives an exhausted template', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 1);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 1 });
    const exhausted = await getRecipe(app, prep.id);
    expect(exhausted.remaining_uses).toBe(0);
    expect(exhausted.is_archived).toBe(1);
    await request(app).delete(`/api/log/${entry.id}`);
    const restored = await getRecipe(app, prep.id);
    expect(restored.remaining_uses).toBe(1);
    expect(restored.is_archived).toBe(0);
  });

  it('restore is capped at max_uses', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 3);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 1 });
    // Reactivate-style bump back to 3 while the entry still exists…
    await request(app).post(`/api/recipes/${prep.id}/reactivate`).send({ remaining_uses: 3 });
    // …then deleting the old entry must not push the count past max_uses.
    await request(app).delete(`/api/log/${entry.id}`);
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(3);
  });

  it('editing servings up consumes the delta', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 4);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).put(`/api/log/${entry.id}`).send({ servings: 3 });
    expect(res.status).toBe(200);
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(1);
  });

  it('editing servings down restores the difference', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 4);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 3 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(1);
    await request(app).put(`/api/log/${entry.id}`).send({ servings: 1 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(3);
  });

  it('editing beyond the remaining servings is rejected (409), nothing changes', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 3);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).put(`/api/log/${entry.id}`).send({ servings: 4 }); // needs 3 more, only 2 left
    expect(res.status).toBe(409);
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(2);
    const list = await request(app).get('/api/log?date=2026-04-09');
    expect(list.body[0].servings).toBe(1); // entry untouched
  });

  it('swapping the entry to another recipe restores the old template and charges the new', async () => {
    const app = buildApp();
    const prep = await seedMealPrep(app, 4);
    const other = await seedMealPrep(app, 2);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: prep.id, date: '2026-04-09', servings: 2 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(2);
    await request(app).put(`/api/log/${entry.id}`).send({ recipe_id: other.id, servings: 1 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(4);
    expect((await getRecipe(app, other.id)).remaining_uses).toBe(1);
  });

  it('swapping from a permanent recipe to a template charges the template only', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const prep = await seedMealPrep(app, 2);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    await request(app).put(`/api/log/${entry.id}`).send({ recipe_id: prep.id, servings: 1 });
    expect((await getRecipe(app, prep.id)).remaining_uses).toBe(1);
    expect((await getRecipe(app, recipe.id)).remaining_uses).toBe(null);
  });

  it('deleting an entry for a permanent recipe leaves it untouched', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).delete(`/api/log/${entry.id}`);
    expect(res.status).toBe(204);
    const after = await getRecipe(app, recipe.id);
    expect(after.remaining_uses).toBe(null);
    expect(after.is_archived).toBe(0);
  });
});

describe('PUT /api/log/:id', () => {
  it('updates an entry servings and notes', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const { body: entry } = await request(app)
      .post('/api/log')
      .send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1, notes: 'a' });

    const res = await request(app)
      .put(`/api/log/${entry.id}`)
      .send({ servings: 2.5, notes: 'updated' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(entry.id);
    expect(res.body.date).toBe('2026-04-09');
    expect(res.body.servings).toBe(2.5);
    expect(res.body.notes).toBe('updated');
    expect(res.body.recipe_name).toBe('Oatmeal');
  });

  it('returns 404 for non-existent entry', async () => {
    const res = await request(buildApp()).put('/api/log/999').send({ servings: 2 });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/log/last-for-recipe', () => {
  async function seedIngredient(app, name = 'Oats') {
    const res = await request(app).post('/api/label-ingredients').send({
      name,
      serving_size_text: '100 g',
      grams_per_serving: 100,
      calories: 380,
      protein_g: 13,
      carbs_g: 67,
      fat_g: 7,
      tracking_type: 'weight',
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  it('returns ingredients: null when the recipe has never been logged with a receipt', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const res = await request(app).get(`/api/log/last-for-recipe?recipe_id=${recipe.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      recipe_id: recipe.id,
      log_entry_id: null,
      date: null,
      ingredients: null,
    });
  });

  it('returns 400 without recipe_id', async () => {
    const res = await request(buildApp()).get('/api/log/last-for-recipe');
    expect(res.status).toBe(400);
  });

  it('returns 404 for another user\'s recipe', async () => {
    const { app, db } = buildTestApp();
    const alice = createUser(db, 'alice-last@example.com');
    const bob = createUser(db, 'bob-last@example.com');
    const recipe = await request(app)
      .post('/api/recipes')
      .set(authHeader(db, alice.id))
      .send({ name: 'Alice Bowl', serving_size: '1', calories: 100, protein_g: 10, carbs_g: 10, fat_g: 2 });
    expect(recipe.status).toBe(201);

    const res = await request(app)
      .get(`/api/log/last-for-recipe?recipe_id=${recipe.body.id}`)
      .set(authHeader(db, bob.id));
    expect(res.status).toBe(404);
  });

  it('returns the newest alive receipt for the recipe', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const oats = await seedIngredient(app, 'Oats');
    const berries = await seedIngredient(app, 'Berries');

    await request(app).post('/api/log').send({
      recipe_id: recipe.id,
      date: '2026-04-07',
      time_min: 480,
      servings: 1,
      ingredients: [{ name: 'Oats', label_ingredient_id: oats.id, amount: 40, unit: 'g' }],
    });
    const newer = await request(app).post('/api/log').send({
      recipe_id: recipe.id,
      date: '2026-04-09',
      time_min: 500,
      servings: 1,
      ingredients: [
        { name: 'Oats', label_ingredient_id: oats.id, amount: 80, unit: 'g' },
        { name: 'Berries', label_ingredient_id: berries.id, amount: 100, unit: 'g' },
      ],
    });
    expect(newer.status).toBe(201);

    const res = await request(app).get(`/api/log/last-for-recipe?recipe_id=${recipe.id}`);
    expect(res.status).toBe(200);
    expect(res.body.recipe_id).toBe(recipe.id);
    expect(res.body.log_entry_id).toBe(newer.body.id);
    expect(res.body.date).toBe('2026-04-09');
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.ingredients.map(r => r.label_ingredient_id)).toEqual([oats.id, berries.id]);
    expect(res.body.ingredients[0].amount).toBe(80);
  });

  it('ignores soft-deleted logs', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const oats = await seedIngredient(app);
    const older = await request(app).post('/api/log').send({
      recipe_id: recipe.id,
      date: '2026-04-07',
      servings: 1,
      ingredients: [{ name: 'Oats', label_ingredient_id: oats.id, amount: 40, unit: 'g' }],
    });
    const newer = await request(app).post('/api/log').send({
      recipe_id: recipe.id,
      date: '2026-04-09',
      servings: 1,
      ingredients: [{ name: 'Oats', label_ingredient_id: oats.id, amount: 90, unit: 'g' }],
    });
    expect(newer.status).toBe(201);
    await request(app).delete(`/api/log/${newer.body.id}`);

    const res = await request(app).get(`/api/log/last-for-recipe?recipe_id=${recipe.id}`);
    expect(res.status).toBe(200);
    expect(res.body.log_entry_id).toBe(older.body.id);
    expect(res.body.ingredients[0].amount).toBe(40);
  });
});
