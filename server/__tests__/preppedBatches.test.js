const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createPreppedBatchesRouter } = require('../routes/preppedBatches');
const { createLogRouter } = require('../routes/log');
const { createRecipesRouter } = require('../routes/recipes');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/prepped-batches', createPreppedBatchesRouter(db));
  app.use('/api/log', createLogRouter(db));
  app.use('/api/recipes', createRecipesRouter(db));
  return { app, db };
}

async function seedRecipe(app) {
  const res = await request(app).post('/api/recipes').send({
    name: 'Quick', serving_size: '1', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
  });
  return res.body;
}

describe('prepped batches', () => {
  it('creates and lists active batches', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/prepped-batches').send({
      name: 'Sunday chicken',
      total_weight_g: 1000,
      total_calories: 1200,
      total_protein_g: 250,
      total_carbs_g: 0,
      total_fat_g: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body.remaining_weight_g).toBe(1000);
    const list = await request(app).get('/api/prepped-batches');
    expect(list.body).toHaveLength(1);
  });

  it('depletes on log and restores on delete', async () => {
    const { app, db } = buildApp();
    const batch = await request(app).post('/api/prepped-batches').send({
      name: 'Chicken',
      total_weight_g: 500,
      total_calories: 600,
      total_protein_g: 120,
      total_carbs_g: 0,
      total_fat_g: 10,
    });
    const recipe = await seedRecipe(app);
    const logRes = await request(app).post('/api/log').send({
      recipe_id: recipe.id,
      date: '2026-08-28',
      servings: 1,
      ingredients: [{
        name: 'Chicken',
        amount: 100,
        unit: 'g',
        prepped_batch_id: batch.body.id,
        calories: 120,
        protein_g: 24,
        carbs_g: 0,
        fat_g: 2,
        source: 'library',
      }],
    });
    expect(logRes.status).toBe(201);
    const after = await request(app).get(`/api/prepped-batches/${batch.body.id}`);
    expect(after.body.remaining_weight_g).toBe(400);

    const del = await request(app).delete(`/api/log/${logRes.body.id}`);
    expect(del.status).toBe(204);
    const restored = await request(app).get(`/api/prepped-batches/${batch.body.id}`);
    expect(restored.body.remaining_weight_g).toBe(500);
  });

  it('depletes on custom log and restores after full exhaustion', async () => {
    const { app } = buildApp();
    const batch = await request(app).post('/api/prepped-batches').send({
      name: 'Rice',
      total_weight_g: 200,
      total_calories: 260,
      total_protein_g: 5,
      total_carbs_g: 55,
      total_fat_g: 1,
    });
    const logRes = await request(app).post('/api/log/custom').send({
      date: '2026-08-28',
      name: 'Rice bowl',
      calories: 260,
      protein_g: 5,
      carbs_g: 55,
      fat_g: 1,
      servings: 1,
      ingredients: [{
        name: 'Rice',
        amount: 200,
        unit: 'g',
        prepped_batch_id: batch.body.id,
        calories: 260,
        protein_g: 5,
        carbs_g: 55,
        fat_g: 1,
        source: 'library',
      }],
    });
    expect(logRes.status).toBe(201);
    const depleted = await request(app).get(`/api/prepped-batches/${batch.body.id}?include_depleted=1`);
    expect(depleted.body.remaining_weight_g).toBe(0);
    expect(depleted.body.is_depleted).toBe(true);

    const del = await request(app).delete(`/api/log/${logRes.body.id}`);
    expect(del.status).toBe(204);
    const restored = await request(app).get(`/api/prepped-batches/${batch.body.id}`);
    expect(restored.body.remaining_weight_g).toBe(200);
    expect(restored.body.is_depleted).toBe(false);
  });
});
