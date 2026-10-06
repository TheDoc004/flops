const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  return { app, db };
}

describe('/api/label-ingredients', () => {
  it('POST creates ingredient with source_type', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Chicken',
      base_label: 'Protein',
      brand_name: 'Generic',
      serving_size_text: '100g',
      grams_per_serving: 100,
      calories: 165,
      protein_g: 31,
      carbs_g: 0,
      fat_g: 3.6,
      source_type: 'manual',
    });
    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('manual');
    expect(res.body.brand_name).toBe('Generic');
    expect(res.body.base_label).toBe('Protein');
    expect(res.body.use_count).toBe(0);
    expect(res.body.last_used_at).toBeNull();
  });

  it('POST /used increments use_count and sets last_used_at', async () => {
    const { app } = buildApp();
    const { body: ing } = await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Rice',
      serving_size_text: '50g',
      grams_per_serving: 50,
      calories: 180,
      protein_g: 3.5,
      carbs_g: 39,
      fat_g: 0.4,
      source_type: 'manual',
    });

    const mark = await request(app).post('/api/label-ingredients/used').send({ user_id: 0, ids: [ing.id] });
    expect(mark.status).toBe(200);
    expect(mark.body.updated).toBe(1);

    const list = await request(app).get('/api/label-ingredients?user_id=0');
    const row = list.body.find(x => x.id === ing.id);
    expect(row.use_count).toBe(1);
    expect(row.last_used_at).toBeTruthy();
  });

  it('stores servings_per_container, keeps it when a PUT omits it, clears it on null', async () => {
    const { app } = buildApp();
    const base = {
      user_id: 0, name: 'Salmon', serving_size_text: '113 g', grams_per_serving: 113.4,
      calories: 140, protein_g: 23, carbs_g: 0, fat_g: 5,
    };
    const { body: ing } = await request(app).post('/api/label-ingredients').send({ ...base, servings_per_container: 8 });
    expect(ing.servings_per_container).toBe(8);

    const kept = await request(app).put(`/api/label-ingredients/${ing.id}`).send({ ...base, calories: 150 });
    expect(kept.body.servings_per_container).toBe(8);

    const cleared = await request(app).put(`/api/label-ingredients/${ing.id}`).send({ ...base, servings_per_container: null });
    expect(cleared.body.servings_per_container).toBeNull();
  });
});
