const request = require('supertest');
const { buildTestApp, createUser, authHeader } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');
const { getLocalDateISO } = require('../mcp/dates');

function isoPlus(start, days) {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const range = (min, max) => ({ min, max });
const OLD = {
  calories: range(2400, 2600),
  protein_g: range(150, 180),
  carbs_g: range(250, 300),
  fat_g: range(60, 80),
};

describe('update_goals', () => {
  let app;
  let db;
  let userId;
  let today;
  let yesterday;

  /** Seed a version the way the Goals page saves one: all 7 weekdays via PUT /api/goals. */
  async function saveInApp(effective_start_date, macros = OLD) {
    const goals = [1, 2, 3, 4, 5, 6, 7].map(weekday => {
      const row = { weekday };
      for (const [k, v] of Object.entries(macros)) {
        row[`${k}_min`] = v.min;
        row[`${k}_max`] = v.max;
      }
      return row;
    });
    const res = await request(app)
      .put('/api/goals')
      .set(authHeader(db, userId))
      .send({ effective_start_date, goals });
    expect(res.status).toBe(200);
  }

  const rowFor = date => reads.getGoalsForDate(db, userId, date).for_weekday;
  const sources = date => db
    .prepare('SELECT DISTINCT source FROM day_goal_versions WHERE user_id = ? AND effective_start_date = ?')
    .all(userId, date)
    .map(r => r.source);

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'goals@mcp.test').id;
    today = getLocalDateISO();
    yesterday = isoPlus(today, -1);
    await saveInApp(isoPlus(today, -30));
  });

  it('sets all-days goals from today and leaves yesterday on the old version', () => {
    const r = writes.updateGoals(db, userId, {
      all_days: { calories: range(2200, 2300), protein_g: range(160, 190), carbs_g: range(200, 220), fat_g: range(60, 70) },
    });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ op: 'update_goals', effective_start_date: today, action: 'created', source: 'mcp' });
    expect(r.audit_id).toEqual(expect.any(Number));
    expect(r.goals).toHaveLength(7);
    expect(r.before.effective_start_date).toBe(isoPlus(today, -30));
    expect(r.after.effective_start_date).toBe(today);

    expect(rowFor(today)).toMatchObject({ calories_min: 2200, calories_max: 2300, carbs_g_min: 200, carbs_g_max: 220 });
    expect(rowFor(yesterday)).toMatchObject({ calories_min: 2400, calories_max: 2600, carbs_g_min: 250, carbs_g_max: 300 });
    expect(sources(today)).toEqual(['mcp']);
  });

  it('carries forward the macros and weekdays it was not given', () => {
    const r = writes.updateGoals(db, userId, {
      all_days: { calories: range(2200, 2400), carbs_g: range(180, 220) },
      days: [{ weekday: 6, calories: range(2600, 2800) }],
    });
    expect(r.error).toBeUndefined();
    for (const g of r.goals) {
      expect(g).toMatchObject({ protein_g_min: 150, protein_g_max: 180, fat_g_min: 60, fat_g_max: 80, carbs_g_min: 180 });
      expect(g.calories_min).toBe(g.weekday === 6 ? 2600 : 2200); // days[] wins over all_days
    }
    expect(Object.keys(r.changed)).toHaveLength(7);
    expect(r.changed.Monday).toEqual({
      calories: { before: range(2400, 2600), after: range(2200, 2400) },
      carbs_g: { before: range(250, 300), after: range(180, 220) },
    });

    // Only one weekday given → the other six stay as they were.
    const t = writes.updateGoals(db, userId, {
      start_date: isoPlus(today, 7),
      days: [{ weekday: 1, protein_g: range(170, 200) }],
    });
    expect(Object.keys(t.changed)).toEqual(['Monday']);
    expect(t.goals.find(g => g.weekday === 2)).toMatchObject({ protein_g_min: 150, calories_min: 2200 });
  });

  it('is idempotent on operation_id', () => {
    const args = { all_days: { calories: range(2000, 2200) }, operation_id: 'goals-1' };
    const a = writes.updateGoals(db, userId, args);
    const b = writes.updateGoals(db, userId, { ...args, all_days: { calories: range(1500, 1600) } });
    expect(b.idempotent).toBe(true);
    expect(b.audit_id).toBe(a.audit_id);
    expect(rowFor(today).calories_min).toBe(2000);
    const audits = db.prepare(`SELECT COUNT(*) AS n FROM mcp_write_audit WHERE user_id = ? AND op = 'update_goals'`).get(userId);
    expect(audits.n).toBe(1);
  });

  it('revert removes the new version and restores the previous resolution', () => {
    const r = writes.updateGoals(db, userId, { all_days: { calories: range(2000, 2200) } });
    const rv = writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(rv).toMatchObject({ ok: true, reverted_op: 'update_goals' });
    expect(reads.getGoalsForDate(db, userId, today).effective_start_date).toBe(isoPlus(today, -30));
    expect(rowFor(today).calories_min).toBe(2400);
    expect(sources(today)).toEqual([]);
  });

  it('overwrites a version already starting that day, and revert puts the app version back', async () => {
    await saveInApp(today, { ...OLD, calories: range(2500, 2700) });
    const r = writes.updateGoals(db, userId, { all_days: { fat_g: range(50, 60) } });
    expect(r.action).toBe('overwrote');
    expect(r.carried_forward_from).toBe(today);
    expect(rowFor(today)).toMatchObject({ calories_min: 2500, fat_g_min: 50 });
    const versions = db.prepare('SELECT COUNT(*) AS n FROM day_goal_versions WHERE user_id = ? AND effective_start_date = ?').get(userId, today);
    expect(versions.n).toBe(7);

    writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(rowFor(today)).toMatchObject({ calories_min: 2500, fat_g_min: 60, fat_g_max: 80 });
    expect(sources(today)).toEqual(['app']);
  });

  it('refuses to revert once the version was re-saved in the app', async () => {
    const r = writes.updateGoals(db, userId, { all_days: { calories: range(2000, 2200) } });
    await saveInApp(today, { ...OLD, calories: range(2100, 2300) });
    expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).code).toBe('NOT_REVERTIBLE');
    expect(rowFor(today).calories_min).toBe(2100);
  });

  it('shows up in GET /api/goals (Goals page + adherence calendar versions) like an app save', async () => {
    writes.updateGoals(db, userId, { all_days: { calories: range(2000, 2200) } });
    const res = await request(app).get(`/api/goals?date=${today}`).set(authHeader(db, userId));
    expect(res.body.effective_start_date).toBe(today);
    expect(res.body.goals[0]).toMatchObject({ label: 'Monday', calories_min: 2000, protein_g_min: 150 });
    expect(res.body.versions.map(v => v.effective_start_date)).toEqual([isoPlus(today, -30), today]);
    const past = await request(app).get(`/api/goals?date=${yesterday}`).set(authHeader(db, userId));
    expect(past.body.goals[0].calories_min).toBe(2400);
  });

  it('validates input and writes nothing on failure', () => {
    const bad = [
      [{ start_date: yesterday, all_days: { calories: range(1, 2) } }, 'PAST_DATE'],
      [{ start_date: '2026-02-31', all_days: { calories: range(1, 2) } }, 'INVALID_DATE'],
      [{ start_date: '10/20/2026', all_days: { calories: range(1, 2) } }, 'INVALID_DATE'],
      [{ all_days: { calories: range(2600, 2400) } }, 'INVALID'],
      [{ all_days: { protein_g: range(-5, 100) } }, 'INVALID'],
      [{ all_days: { calories: { min: 2000 } } }, 'INVALID'],
      [{ all_days: { fiber_g: range(20, 30) } }, 'UNKNOWN_PARAM'],
      [{ days: [{ weekday: 8, calories: range(1, 2) }] }, 'INVALID'],
      [{ days: [{ weekday: 1, calories: range(1, 2) }, { weekday: 1, fat_g: range(1, 2) }] }, 'INVALID'],
      [{ days: [{ weekday: 1 }] }, 'INVALID'],
      [{}, 'INVALID'],
      [{ all_days: { calories: range(1, 2) }, effective_start_date: today }, 'UNKNOWN_PARAM'],
    ];
    for (const [args, code] of bad) {
      expect(writes.updateGoals(db, userId, args)).toMatchObject({ code, error: expect.any(String) });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM day_goal_versions WHERE user_id = ?').get(userId).n).toBe(7);
  });

  it('null clears a macro', () => {
    const r = writes.updateGoals(db, userId, { all_days: { fat_g: null } });
    expect(r.error).toBeUndefined();
    expect(rowFor(today)).toMatchObject({ fat_g_min: null, fat_g_max: null, protein_g_min: 150 });
  });

  it('warns (not blocks) on a calorie/macro mismatch and on a later version', () => {
    // Seeded macros at midpoints: 4×165 + 4×275 + 9×70 = 2390 kcal.
    const ok = writes.updateGoals(db, userId, { all_days: { calories: range(2300, 2500) } });
    expect(ok.warnings).toEqual([]);

    const later = isoPlus(today, 14);
    writes.updateGoals(db, userId, { start_date: later, all_days: { calories: range(2300, 2500) } });
    const r = writes.updateGoals(db, userId, { start_date: isoPlus(today, 3), all_days: { calories: range(3400, 3600) } });
    expect(r.error).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday: calories 3500 vs 2390/);
    expect(r.warnings.join(' ')).toMatch(new RegExp(`later goal version already starts ${later}`));
  });

  it('works inside write_batch and reverts with the batch', () => {
    const b = writes.writeBatch(db, userId, {
      operations: [
        { op: 'update_goals', all_days: { calories: range(2000, 2200) } },
        { op: 'update_goals', days: [{ weekday: 7, calories: range(2800, 3000) }] },
      ],
    });
    expect(b.error).toBeUndefined();
    expect(b.result_row_ids.goal_version_dates).toEqual([today, today]);
    expect(b.results[1].action).toBe('overwrote');
    writes.revertMcpWrite(db, userId, { audit_id: b.audit_id });
    expect(reads.getGoalsForDate(db, userId, today).effective_start_date).toBe(isoPlus(today, -30));
  });
});

/** The same tool through the real MCP server, so the Zod inputSchema is exercised too. */
describe('update_goals over MCP', () => {
  let app;
  let db;
  let userId;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'goals-mcp@mcp.test').id;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
  });
  afterEach(() => {
    if (prevToken === undefined) delete process.env.MCP_API_TOKEN;
    else process.env.MCP_API_TOKEN = prevToken;
    if (prevUser === undefined) delete process.env.MCP_USER_ID;
    else process.env.MCP_USER_ID = prevUser;
  });

  const call = async (name, args) => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    expect(res.status).toBe(200);
    return res.body.result;
  };

  it('sets all days, then bumps carbs on chosen weekdays only', async () => {
    const all = await call('update_goals', {
      all_days: {
        calories: range(3200, 3250),
        protein_g: range(170, 190),
        carbs_g: range(440, 460),
        fat_g: range(70, 80),
      },
    });
    expect(all.isError).toBeFalsy();
    const first = JSON.parse(all.content[0].text);
    expect(first.effective_start_date).toBe(getLocalDateISO());
    expect(Object.keys(first.changed)).toHaveLength(7);
    expect(first.audit_id).toBeTruthy();

    const bump = await call('update_goals', {
      days: [1, 3, 5].map(weekday => ({ weekday, carbs_g: range(460, 480) })),
    });
    const second = JSON.parse(bump.content[0].text);
    expect(Object.keys(second.changed).sort()).toEqual(['Friday', 'Monday', 'Wednesday']);
    expect(second.changed.Monday).toEqual({
      carbs_g: { before: range(440, 460), after: range(460, 480) },
    });
    const tue = second.goals.find(g => g.weekday === 2);
    expect([tue.carbs_g_min, tue.calories_min, tue.protein_g_max]).toEqual([440, 3200, 190]);
    expect(reads.getGoalsForDate(db, userId).for_weekday.calories_max).toBe(3250);
  });

  it('refuses unknown parameters and writes nothing', async () => {
    const res = await call('update_goals', { all_days: { calories: range(2000, 2100) }, effective_date: '2030-01-01' });
    expect(res.isError).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM day_goal_versions WHERE user_id = ?').get(userId).n).toBe(0);
  });
});
