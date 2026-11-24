const request = require('supertest');
const { buildTestApp, authHeader, createUser } = require('./helpers');

const TOKEN = 'test-reports-token';
const REPORT_KEYS = ['app_version', 'created_at', 'id', 'route', 'status', 'text', 'user_id'];

describe('problem reports', () => {
  let app;
  let db;
  let alice;
  let bob;
  const prevToken = process.env.PROBLEM_REPORTS_TOKEN;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    alice = createUser(db, 'alice@reports.test');
    bob = createUser(db, 'bob@reports.test');
    process.env.PROBLEM_REPORTS_TOKEN = TOKEN;
  });

  afterAll(() => {
    if (prevToken === undefined) delete process.env.PROBLEM_REPORTS_TOKEN;
    else process.env.PROBLEM_REPORTS_TOKEN = prevToken;
  });

  function inbox() {
    return request(app).get('/api/problem-reports').set('x-api-key', TOKEN);
  }

  it('a signed-in user files a report that stores only text, route, version, user and time', async () => {
    const res = await request(app)
      .post('/api/problem-reports')
      .set(authHeader(db, alice.id))
      .send({ text: '  Save button does nothing  ', route: '/history?date=2026-08-01#x', user_id: bob.id, extra: 'x' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(REPORT_KEYS);
    expect(res.body).toMatchObject({
      user_id: alice.id,
      text: 'Save button does nothing',
      route: '/history',
      status: 'new',
    });

    const stored = db.prepare('SELECT * FROM problem_reports').all();
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(REPORT_KEYS);
  });

  it('refuses an empty report', async () => {
    const res = await request(app).post('/api/problem-reports').set(authHeader(db, alice.id)).send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('the inbox lists new reports from every user, and nothing but report rows', async () => {
    await request(app).post('/api/log/custom').set(authHeader(db, alice.id)).send({
      date: '2026-08-01', name: 'Secret meal', servings: 1, calories: 400, protein_g: 30, carbs_g: 20, fat_g: 10,
    }).expect(201);
    await request(app).put('/api/body-weights').set(authHeader(db, alice.id))
      .send({ date: '2026-08-01', weight_kg: 81.3 }).expect(200);

    await request(app).post('/api/problem-reports').set(authHeader(db, alice.id)).send({ text: 'A broke', route: '/' });
    await request(app).post('/api/problem-reports').set(authHeader(db, bob.id)).send({ text: 'B broke', route: '/training' });
    db.prepare(`UPDATE problem_reports SET status = 'done' WHERE text = 'B broke'`).run();

    const res = await inbox();
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.text)).toEqual(['A broke']);
    for (const row of res.body) expect(Object.keys(row).sort()).toEqual(REPORT_KEYS);
    expect(res.text).not.toContain('Secret meal');
    expect(res.text).not.toContain('81.3');
  });

  it('a user session cannot read the inbox — not their own reports, not anyone else\'s', async () => {
    await request(app).post('/api/problem-reports').set(authHeader(db, alice.id)).send({ text: 'A broke' });
    for (const user of [alice, bob]) {
      const res = await request(app).get('/api/problem-reports').set(authHeader(db, user.id));
      expect(res.status).toBe(401);
      expect(res.text).not.toContain('A broke');
    }
    const wrong = await request(app).get('/api/problem-reports').set('x-api-key', 'nope');
    expect(wrong.status).toBe(401);
  });

  it('the inbox is closed when no token is configured', async () => {
    delete process.env.PROBLEM_REPORTS_TOKEN;
    const res = await request(app).get('/api/problem-reports').set('x-api-key', '');
    expect(res.status).toBe(503);
  });

  it('filing a report needs a real session outside the Jest owner fallback', async () => {
    const prevJest = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app).post('/api/problem-reports').send({ text: 'anon' });
      expect(res.status).toBe(401);
    } finally {
      process.env.JEST_WORKER_ID = prevJest;
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM problem_reports').get().n).toBe(0);
  });
});
