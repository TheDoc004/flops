const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createRecipesRouter } = require('../routes/recipes');
const { createLogRouter } = require('../routes/log');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/log', createLogRouter(db));
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
