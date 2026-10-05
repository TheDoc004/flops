const request = require('supertest');
const { buildTestApp, createUser, authHeader } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

describe('MCP log_body_weight', () => {
  let app;
  let db;
  let userId;
  const row = date =>
    db.prepare('SELECT weight_kg, source FROM body_weights WHERE user_id = ? AND date = ?').get(userId, date);

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'weigh@mcp.test').id;
  });

  it('converts lb exactly like the app, flags source=mcp, shows in reads', () => {
    const r = writes.logBodyWeight(db, userId, { weight: 151.9, unit: 'lb', date: '2026-10-05' });
    expect(r.error).toBeUndefined();
    expect(r.audit_id).toBeTruthy();
    expect(r).toMatchObject({ date: '2026-10-05', weight_kg: 68.9, weight_lb: 151.9, replaced: null, source: 'mcp' });
    expect(row('2026-10-05')).toEqual({ weight_kg: 151.9 / 2.20462, source: 'mcp' });
    expect(reads.getDay(db, userId, '2026-10-05').body_weight_kg).toBeCloseTo(68.9008, 4);
    expect(reads.getBodyWeights(db, userId, '2026-10-01', '2026-10-05')[0])
      .toEqual({ date: '2026-10-05', weight_kg: 151.9 / 2.20462 });
  });

  it('kg input; defaults date to server-local today', () => {
    const r = writes.logBodyWeight(db, userId, { weight: 69, unit: 'kg' });
    expect(r.weight_lb).toBe(152.1);
    const { getLocalDateISO } = require('../mcp/dates');
    expect(r.date).toBe(getLocalDateISO());
  });

  it('overwrites the same date like the app and revert restores the replaced value', async () => {
    await request(app).put('/api/body-weights').set(authHeader(db, userId))
      .send({ date: '2026-10-05', weight_kg: 70 }).expect(200);
    expect(row('2026-10-05')).toEqual({ weight_kg: 70, source: 'app' });

    const r = writes.logBodyWeight(db, userId, { weight: 151.9, unit: 'lb', date: '2026-10-05' });
    expect(r.replaced).toMatchObject({ weight_kg: 70, weight_lb: 154.3, source: 'app' });
    expect(r.warnings).toEqual([]);

    expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).ok).toBe(true);
    expect(row('2026-10-05')).toEqual({ weight_kg: 70, source: 'app' });
  });

  it('revert of a new weigh-in deletes it', () => {
    const r = writes.logBodyWeight(db, userId, { weight: 69, unit: 'kg', date: '2026-10-05' });
    writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(row('2026-10-05')).toBeUndefined();
  });

  it('refuses to revert once the app re-entered that date', async () => {
    const r = writes.logBodyWeight(db, userId, { weight: 69, unit: 'kg', date: '2026-10-05' });
    await request(app).put('/api/body-weights').set(authHeader(db, userId))
      .send({ date: '2026-10-05', weight_kg: 68.5 }).expect(200);
    const rev = writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(rev.code).toBe('NOT_REVERTIBLE');
    expect(row('2026-10-05')).toEqual({ weight_kg: 68.5, source: 'app' });
  });

  it('rejects nonsense values, bad units, bad dates and unknown params without writing', () => {
    expect(writes.logBodyWeight(db, userId, { weight: 0, unit: 'kg' }).error).toMatch(/positive/);
    expect(writes.logBodyWeight(db, userId, { weight: 15, unit: 'kg' }).code).toBe('OUT_OF_RANGE');
    expect(writes.logBodyWeight(db, userId, { weight: 700, unit: 'lb' }).code).toBe('OUT_OF_RANGE');
    expect(writes.logBodyWeight(db, userId, { weight: 150 }).error).toMatch(/unit is required/);
    expect(writes.logBodyWeight(db, userId, { weight: 150, unit: 'stone' }).error).toMatch(/unit is required/);
    expect(writes.logBodyWeight(db, userId, { weight: 150, unit: 'lb', date: '10/05/2026' }).error).toMatch(/YYYY-MM-DD/);
    expect(writes.logBodyWeight(db, userId, { weight: 150, unit: 'lb', weight_kg: 68 }).code).toBe('UNKNOWN_PARAM');
    expect(db.prepare('SELECT COUNT(*) AS n FROM body_weights').get().n).toBe(0);
  });

  it('warns (but writes) on a >3 kg jump from the previous weigh-in', () => {
    writes.logBodyWeight(db, userId, { weight: 69, unit: 'kg', date: '2026-10-04' });
    const r = writes.logBodyWeight(db, userId, { weight: 160.9, unit: 'lb', date: '2026-10-05' });
    expect(r.previous_weigh_in).toMatchObject({ date: '2026-10-04', weight_kg: 69 });
    expect(r.warnings.join(' ')).toMatch(/differs from the previous weigh-in/);
    expect(row('2026-10-05')).toBeTruthy();
  });

  it('works inside write_batch, rolls back with it, and batch revert restores', () => {
    writes.logBodyWeight(db, userId, { weight: 70, unit: 'kg', date: '2026-10-05' });
    const failed = writes.writeBatch(db, userId, {
      operations: [
        { op: 'log_body_weight', weight: 151.9, unit: 'lb', date: '2026-10-05' },
        { op: 'delete_meal_entry', log_entry_id: 99999 },
      ],
    });
    expect(failed.error).toBeTruthy();
    expect(row('2026-10-05').weight_kg).toBe(70);

    const ok = writes.writeBatch(db, userId, {
      operations: [{ op: 'log_body_weight', weight: 151.9, unit: 'lb', date: '2026-10-05' }],
    });
    expect(ok.error).toBeUndefined();
    expect(ok.result_row_ids.body_weight_dates).toEqual(['2026-10-05']);
    expect(row('2026-10-05').source).toBe('mcp');
    writes.revertMcpWrite(db, userId, { audit_id: ok.audit_id });
    expect(row('2026-10-05')).toEqual({ weight_kg: 70, source: 'mcp' });
  });

  it('app PUT still returns { date, weight_kg } only', async () => {
    const res = await request(app).put('/api/body-weights').set(authHeader(db, userId))
      .send({ date: '2026-10-05', weight_kg: 68.9 }).expect(200);
    expect(res.body).toEqual({ date: '2026-10-05', weight_kg: 68.9 });
  });
});
