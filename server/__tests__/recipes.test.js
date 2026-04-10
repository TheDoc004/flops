const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createRecipesRouter } = require('../routes/recipes');

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

  it('returns 409 when recipe has log entries', async () => {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/recipes', createRecipesRouter(db));
    const { body: recipe } = await request(app).post('/api/recipes').send(sample);
    db.prepare('INSERT INTO log_entries (recipe_id, date, servings) VALUES (?, ?, ?)').run(recipe.id, '2026-04-09', 1);
    const res = await request(app).delete(`/api/recipes/${recipe.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/log/i);
  });
});
