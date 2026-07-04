const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createTrainingRouter } = require('../routes/training');
const { createRecipesRouter } = require('../routes/recipes');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/training', createTrainingRouter(db));
  app.use('/api/recipes', createRecipesRouter(db));
  return { app, db };
}

describe('/api/training/schedule', () => {
  it('GET returns 7 days', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/training/schedule');
    expect(res.status).toBe(200);
    expect(res.body.schedule).toHaveLength(7);
  });

  it('PUT upserts a weekday row', async () => {
    const { app } = buildApp();
    const res = await request(app).put('/api/training/schedule').send({
      user_id: 0,
      schedule: [{ weekday: 1, enabled: 1, time_min: 7 * 60, workout_type: 'Lift', duration_min: 60 }],
    });
    expect(res.status).toBe(200);
  });
});

describe('/api/training/override', () => {
  it('PUT creates and GET returns override', async () => {
    const { app } = buildApp();
    await request(app).put('/api/training/override').send({
      user_id: 0,
      date: '2026-04-10',
      enabled: 1,
      time_min: 18 * 60,
      workout_type: 'Run',
      duration_min: 45,
    });
    const res = await request(app).get('/api/training/override?date=2026-04-10');
    expect(res.status).toBe(200);
    expect(res.body.workout_type).toBe('Run');
  });
});

describe('/api/training/daily-context', () => {
  it('GET defaults to rest when missing', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/training/daily-context?date=2026-06-01');
    expect(res.status).toBe(200);
    expect(res.body.context_type).toBe('rest');
    expect(res.body.date).toBe('2026-06-01');
  });

  it('PUT persists and GET returns saved type', async () => {
    const { app } = buildApp();
    await request(app).put('/api/training/daily-context').send({
      user_id: 0,
      date: '2026-06-02',
      context_type: 'heavy_lifting',
    });
    const res = await request(app).get('/api/training/daily-context?date=2026-06-02');
    expect(res.status).toBe(200);
    expect(res.body.context_type).toBe('heavy_lifting');
  });

  it('PUT rejects invalid context_type', async () => {
    const { app } = buildApp();
    const res = await request(app).put('/api/training/daily-context').send({
      user_id: 0,
      date: '2026-06-03',
      context_type: 'invalid',
    });
    expect(res.status).toBe(400);
  });
});

describe('/api/training/feedback', () => {
  it('PUT creates and GET returns feedback', async () => {
    const { app } = buildApp();
    const put = await request(app).put('/api/training/feedback').send({
      user_id: 0,
      date: '2026-04-10',
      energy: 'great',
      stomach: 'fine',
      performance: 'strong',
      notes: 'Felt good',
    });
    expect(put.status).toBe(200);
    const get = await request(app).get('/api/training/feedback?date=2026-04-10');
    expect(get.status).toBe(200);
    expect(get.body.energy).toBe('great');
  });
});

