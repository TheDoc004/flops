const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createWorkoutsRouter } = require('../routes/workouts');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/workouts', createWorkoutsRouter(db));
  return { app, db };
}

describe('/api/workouts presets', () => {
  it('creates and lists presets', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/workouts/presets').send({ user_id: 0, name: 'Push', intensity_label: 'Heavy' });
    expect(created.status).toBe(201);
    const list = await request(app).get('/api/workouts/presets?user_id=0');
    expect(list.status).toBe(200);
    expect(list.body.find(p => p.name === 'Push')).toBeTruthy();
  });

  it('sets today selection by date', async () => {
    const { app } = buildApp();
    const { body: preset } = await request(app).post('/api/workouts/presets').send({ user_id: 0, name: 'Legs' });
    const put = await request(app).put('/api/workouts/today').send({ user_id: 0, date: '2026-06-01', preset_id: preset.id });
    expect(put.status).toBe(200);
    expect(put.body.preset_id).toBe(preset.id);
    const get = await request(app).get('/api/workouts/today?user_id=0&date=2026-06-01');
    expect(get.status).toBe(200);
    expect(get.body.preset_name).toBe('Legs');
  });
});

describe('/api/workouts exercises + logs', () => {
  it('adds exercises to a preset and logs performance', async () => {
    const { app } = buildApp();
    const { body: preset } = await request(app).post('/api/workouts/presets').send({ user_id: 0, name: 'Pull' });
    const ex = await request(app).post(`/api/workouts/presets/${preset.id}/exercises`).send({ user_id: 0, name: 'Row' });
    expect(ex.status).toBe(201);

    const log = await request(app).post('/api/workouts/logs').send({
      user_id: 0,
      date: '2026-06-02',
      preset_id: preset.id,
      exercise_name: 'Row',
      weight: 185,
      weight_unit: 'lb',
      reps: 8,
      sets: 3,
    });
    expect(log.status).toBe(201);
    expect(log.body.exercise_name).toBe('Row');

    const prog = await request(app).get('/api/workouts/progress?user_id=0&exercise_name=Row');
    expect(prog.status).toBe(200);
    expect(prog.body).toHaveLength(1);
    expect(prog.body[0].reps).toBe(8);
  });
});

