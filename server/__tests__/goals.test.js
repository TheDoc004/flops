const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../db');
const { createGoalsRouter } = require('../routes/goals');

function buildApp(db = createDb(':memory:')) {
  const app = express();
  app.use(express.json());
  app.use('/api/goals', createGoalsRouter(db));
  return { app, db };
}

describe('GET /api/goals', () => {
  it('returns seven days with null macros when empty', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/goals?date=2026-01-01');
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(0);
    expect(res.body.goals).toHaveLength(7);
    expect(res.body.goals[0].weekday).toBe(1);
    expect(res.body.goals[0].label).toBe('Monday');
    expect(res.body.goals[6].weekday).toBe(7);
    expect(res.body.goals.every(g => g.calories_min == null && g.protein_g_min == null)).toBe(true);
    expect(res.body.versions).toEqual([]);
  });

  it('returns 400 for invalid user_id', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/goals?user_id=-1');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/goals', () => {
  it('saves min/max ranges and GET reflects them for the effective date', async () => {
    const { app } = buildApp();
    const put = await request(app)
      .put('/api/goals')
      .send({
        effective_start_date: '2026-01-10',
        goals: [
          { weekday: 1, calories_min: 2000, calories_max: 2200, protein_g_min: 150, protein_g_max: 170, carbs_g_min: 200, carbs_g_max: 240, fat_g_min: 65, fat_g_max: 75 },
          { weekday: 7, calories_min: 1800, calories_max: 1800, protein_g_min: null, protein_g_max: null, carbs_g_min: null, carbs_g_max: null, fat_g_min: null, fat_g_max: null },
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.effective_start_date).toBe('2026-01-10');
    expect(put.body.goals.find(g => g.weekday === 1).calories_min).toBe(2000);
    expect(put.body.goals.find(g => g.weekday === 1).calories_max).toBe(2200);
    const get = await request(app).get('/api/goals?date=2026-01-11');
    expect(get.body.goals.find(g => g.weekday === 1).protein_g_min).toBe(150);
    expect(get.body.goals.find(g => g.weekday === 1).protein_g_max).toBe(170);
    expect(get.body.goals.find(g => g.weekday === 3).calories_min).toBeNull();
  });

  it('rejects invalid weekday', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/goals')
      .send({ goals: [{ weekday: 8, calories_min: 1, calories_max: 1 }] });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate weekdays', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/goals')
      .send({
        goals: [
          { weekday: 1, calories_min: 1, calories_max: 1 },
          { weekday: 1, calories_min: 2, calories_max: 2 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('rejects min greater than max', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/goals')
      .send({
        goals: [{ weekday: 2, calories_min: 2000, calories_max: 1800 }],
      });
    expect(res.status).toBe(400);
  });

  it('treats single-value legacy fields as exact targets', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/goals')
      .send({
        effective_start_date: '2026-01-05',
        goals: [{ weekday: 2, calories: '', protein_g: 'not-a-number', carbs_g: -5, fat_g: 10 }],
      });
    expect(res.status).toBe(200);
    const tue = res.body.goals.find(g => g.weekday === 2);
    expect(tue.calories_min).toBeNull();
    expect(tue.protein_g_min).toBeNull();
    expect(tue.carbs_g_min).toBeNull();
    expect(tue.fat_g_min).toBe(10);
    expect(tue.fat_g_max).toBe(10);
  });

  it('resolves past dates against the version active at that time', async () => {
    const { app } = buildApp();
    await request(app)
      .put('/api/goals')
      .send({
        effective_start_date: '2026-01-01',
        goals: [{ weekday: 1, calories_min: 1800, calories_max: 1900 }],
      })
      .expect(200);
    await request(app)
      .put('/api/goals')
      .send({
        effective_start_date: '2026-02-01',
        goals: [{ weekday: 1, calories_min: 2800, calories_max: 3000 }],
      })
      .expect(200);

    const january = await request(app).get('/api/goals?date=2026-01-12').expect(200);
    const february = await request(app).get('/api/goals?date=2026-02-02').expect(200);
    expect(january.body.goals.find(g => g.weekday === 1).calories_min).toBe(1800);
    expect(february.body.goals.find(g => g.weekday === 1).calories_min).toBe(2800);
    expect(february.body.versions).toHaveLength(2);
  });

  it('migrates legacy day_goals rows into an initial version on reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-db-'));
    const dbPath = path.join(dir, 'nutrition.db');
    const db1 = createDb(dbPath);
    db1.prepare('INSERT INTO day_goals (user_id, weekday, calories, protein_g, carbs_g, fat_g) VALUES (0, 1, 2000, 150, 250, 60)').run();
    db1.close();

    const db2 = createDb(dbPath);
    const migrated = db2
      .prepare('SELECT effective_start_date, calories_min, calories_max FROM day_goal_versions WHERE user_id = 0 AND weekday = 1')
      .get();
    expect(migrated.effective_start_date).toBe('1970-01-01');
    expect(migrated.calories_min).toBe(2000);
    expect(migrated.calories_max).toBe(2000);
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
