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
  return app;
}

const sample = {
  name: 'Oatmeal', serving_size: '1 cup',
  calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
};

describe('GET /api/recipes', () => {
  it('returns empty array when no recipes exist', async () => {
    const res = await request(buildApp()).get('/api/recipes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all recipes sorted by name', async () => {
    const app = buildApp();
    await request(app).post('/api/recipes').send({ ...sample, name: 'Zucchini' });
    await request(app).post('/api/recipes').send({ ...sample, name: 'Apple' });
    const res = await request(app).get('/api/recipes');
    expect(res.body[0].name).toBe('Apple');
    expect(res.body[1].name).toBe('Zucchini');
  });

  it('hides archived recipes by default', async () => {
    const app = buildApp();
    const { body: r } = await request(app).post('/api/recipes').send({
      ...sample,
      name: 'ArchivedTpl',
      recipe_kind: 'limited',
      max_uses: 1,
      remaining_uses: 1,
      is_archived: 1,
    });
    expect(r.is_archived).toBe(1);
    const list = await request(app).get('/api/recipes');
    expect(list.body.find(x => x.name === 'ArchivedTpl')).toBeUndefined();
    const all = await request(app).get('/api/recipes?include_archived=1');
    expect(all.body.find(x => x.name === 'ArchivedTpl')).toBeDefined();
  });

  it('hides quick food recipes by default', async () => {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/recipes', createRecipesRouter(db));

    db.prepare(
      `INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, ingredients, recipe_kind, is_archived, meal_builder_meta, is_quick_food)
       VALUES ('Banana', '100 g', 89, 1.1, 22.8, 0.3, '[]', 'permanent', 0, NULL, 1)`
    ).run();

    const res = await request(app).get('/api/recipes');
    expect(res.status).toBe(200);
    expect(res.body.find(r => r.name === 'Banana')).toBeUndefined();

    const all = await request(app).get('/api/recipes?include_quick=1');
    expect(all.status).toBe(200);
    expect(all.body.find(r => r.name === 'Banana')).toBeDefined();
  });
});

describe('POST /api/recipes', () => {
  it('creates a recipe and returns it with an id', async () => {
    const res = await request(buildApp()).post('/api/recipes').send(sample);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Oatmeal');
    expect(res.body.calories).toBe(150);
  });

  it('stores fiber_g as null when not provided', async () => {
    const res = await request(buildApp()).post('/api/recipes').send(sample);
    expect(res.body.fiber_g).toBeNull();
  });

  it('stores fiber_g when provided', async () => {
    const res = await request(buildApp()).post('/api/recipes').send({ ...sample, fiber_g: 4 });
    expect(res.body.fiber_g).toBe(4);
  });

  it('stores and returns ingredients', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/recipes').send({
      ...sample,
      ingredients: [{ name: 'Rolled oats', amount: '1/2 cup' }, { name: 'Milk', amount: '1 cup' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.ingredients).toEqual([
      { kind: 'line', name: 'Rolled oats', amount: '1/2 cup' },
      { kind: 'line', name: 'Milk', amount: '1 cup' },
    ]);
    const list = await request(app).get('/api/recipes');
    expect(list.body[0].ingredients).toEqual(res.body.ingredients);
  });

  it('defaults ingredients to empty array when omitted', async () => {
    const res = await request(buildApp()).post('/api/recipes').send(sample);
    expect(res.body.ingredients).toEqual([]);
  });

  it('returns 400 when ingredients is not an array', async () => {
    const res = await request(buildApp()).post('/api/recipes').send({ ...sample, ingredients: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', async () => {
    const { name, ...body } = sample;
    const res = await request(buildApp()).post('/api/recipes').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when calories is missing', async () => {
    const { calories, ...body } = sample;
    const res = await request(buildApp()).post('/api/recipes').send(body);
    expect(res.status).toBe(400);
  });

  it('creates limited-use template with uses', async () => {
    const res = await request(buildApp()).post('/api/recipes').send({
      ...sample,
      name: 'Prep A',
      recipe_kind: 'limited',
      max_uses: 5,
      remaining_uses: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.recipe_kind).toBe('limited');
    expect(res.body.remaining_uses).toBe(5);
    expect(res.body.max_uses).toBe(5);
  });
});

describe('POST /api/recipes/:id/reactivate', () => {
  it('un-archives a limited template after uses are exhausted', async () => {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/recipes', createRecipesRouter(db));
    app.use('/api/log', createLogRouter(db));

    const { body: r } = await request(app).post('/api/recipes').send({
      ...sample,
      name: 'OneUse',
      recipe_kind: 'limited',
      max_uses: 1,
      remaining_uses: 1,
    });
    await request(app).post('/api/log').send({ recipe_id: r.id, date: '2026-01-01', servings: 1 });
    const list = await request(app).get('/api/recipes');
    expect(list.body.find(x => x.id === r.id)).toBeUndefined();

    const res = await request(app).post(`/api/recipes/${r.id}/reactivate`).send({ remaining_uses: 3 });
    expect(res.status).toBe(200);
    expect(res.body.is_archived).toBe(0);
    expect(res.body.remaining_uses).toBe(3);
  });
});

describe('PUT /api/recipes/:id', () => {
  it('updates an existing recipe', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).put(`/api/recipes/${created.id}`).send({
      ...sample, name: 'Steel Cut Oats', calories: 170,
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Steel Cut Oats');
    expect(res.body.calories).toBe(170);
  });

  it('preserves ingredients when PUT body omits ingredients', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send({
      ...sample,
      ingredients: [{ name: 'Salt', amount: 'pinch' }],
    });
    const res = await request(app).put(`/api/recipes/${created.id}`).send({
      ...sample, name: 'Renamed', calories: 200,
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.ingredients).toEqual([{ kind: 'line', name: 'Salt', amount: 'pinch' }]);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).put('/api/recipes/999').send(sample);
    expect(res.status).toBe(404);
  });

  it('returns 400 when required fields are missing', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).put(`/api/recipes/${created.id}`).send({ name: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/recipes/:id', () => {
  it('deletes a recipe and returns 204', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).delete(`/api/recipes/${created.id}`);
    expect(res.status).toBe(204);
    const list = await request(app).get('/api/recipes');
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).delete('/api/recipes/999');
    expect(res.status).toBe(404);
  });

  it('allows deleting a recipe even when it has log entries', async () => {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/recipes', createRecipesRouter(db));
    app.use('/api/log', createLogRouter(db));
    const { body: recipe } = await request(app).post('/api/recipes').send(sample);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).delete(`/api/recipes/${recipe.id}`);
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/recipes');
    expect(list.body.find(r => r.id === recipe.id)).toBeUndefined();

    // Historical logs still load (snapshot-based).
    const day = await request(app).get('/api/log?date=2026-04-09');
    expect(day.status).toBe(200);
    expect(day.body).toHaveLength(1);
    expect(day.body[0].recipe_name).toBe('Oatmeal');
  });
});
