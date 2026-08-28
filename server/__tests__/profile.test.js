const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createProfileRouter, createBodyWeightsRouter } = require('../routes/profile');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/profile', createProfileRouter(db));
  app.use('/api/body-weights', createBodyWeightsRouter(db));
  return app;
}

describe('GET /api/profile', () => {
  it('returns empty profile for new user', async () => {
    const res = await request(buildApp()).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(1);
    expect(res.body.height_cm).toBeNull();
  });
});

describe('PUT /api/profile', () => {
  it('upserts profile fields', async () => {
    const app = buildApp();
    const res = await request(app).put('/api/profile').send({
      user_id: 0,
      height_cm: 180,
      age: 30,
      sex: 'male',
      activity_level: 'moderate',
    });
    expect(res.status).toBe(200);
    expect(res.body.height_cm).toBe(180);
    expect(res.body.sex).toBe('male');
  });

  it('merges partial updates', async () => {
    const app = buildApp();
    await request(app).put('/api/profile').send({ user_id: 0, height_cm: 175 });
    const res = await request(app).put('/api/profile').send({ user_id: 0, age: 25 });
    expect(res.status).toBe(200);
    expect(res.body.height_cm).toBe(175);
    expect(res.body.age).toBe(25);
  });

  it('stores macro_units', async () => {
    const app = buildApp();
    const res = await request(app).put('/api/profile').send({ user_id: 0, macro_units: 'us' });
    expect(res.status).toBe(200);
    expect(res.body.macro_units).toBe('us');
    const get = await request(app).get('/api/profile');
    expect(get.body.macro_units).toBe('us');
  });

  it('stores dashboard weight chart preferences', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/profile')
      .send({ user_id: 0, dash_weight_chart_enabled: 0, dash_weight_days: 14 });
    expect(res.status).toBe(200);
    expect(res.body.dash_weight_chart_enabled).toBe(0);
    expect(res.body.dash_weight_days).toBe(14);
    const get = await request(app).get('/api/profile');
    expect(get.body.dash_weight_days).toBe(14);
  });

  it('round-trips dash_layout_json', async () => {
    const app = buildApp();
    const layout = {
      version: 1,
      cards: [{ id: 'macros', x: 0, y: 0, w: 12, h: 4, visible: true }],
    };
    const res = await request(app).put('/api/profile').send({ user_id: 0, dash_layout_json: layout });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.dash_layout_json)).toEqual(layout);
    const get = await request(app).get('/api/profile');
    expect(JSON.parse(get.body.dash_layout_json)).toEqual(layout);
  });

  it('stores dashboard card visibility flags', async () => {
    const app = buildApp();
    const res = await request(app).put('/api/profile').send({
      user_id: 0,
      dash_weight_enabled: 0,
      dash_meals_enabled: 0,
      dash_weight_chart_card_enabled: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.dash_weight_enabled).toBe(0);
    expect(res.body.dash_meals_enabled).toBe(0);
    expect(res.body.dash_weight_chart_card_enabled).toBe(1);
  });

  it('stores body_units independently', async () => {
    const app = buildApp();
    let res = await request(app).put('/api/profile').send({ user_id: 0, macro_units: 'metric', body_units: 'us' });
    expect(res.status).toBe(200);
    expect(res.body.macro_units).toBe('metric');
    expect(res.body.body_units).toBe('us');
    res = await request(app).put('/api/profile').send({ user_id: 0, macro_units: 'us' });
    expect(res.body.macro_units).toBe('us');
    expect(res.body.body_units).toBe('us');
  });
});

describe('/api/body-weights', () => {
  it('PUT creates and updates one entry per day', async () => {
    const app = buildApp();
    let res = await request(app).put('/api/body-weights').send({ user_id: 0, date: '2026-04-01', weight_kg: 80 });
    expect(res.status).toBe(200);
    expect(res.body.weight_kg).toBe(80);
    res = await request(app).put('/api/body-weights').send({ user_id: 0, date: '2026-04-01', weight_kg: 79.5 });
    expect(res.body.weight_kg).toBe(79.5);
    const list = await request(app).get('/api/body-weights');
    expect(list.body).toHaveLength(1);
  });

  it('returns 400 for bad weight', async () => {
    const res = await request(buildApp()).put('/api/body-weights').send({ user_id: 0, date: '2026-04-01', weight_kg: -1 });
    expect(res.status).toBe(400);
  });
});
