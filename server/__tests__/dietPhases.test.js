const request = require('supertest');
const { buildTestApp, createUser, authHeader } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');
const { listPhases } = require('../dietPhases');

describe('diet phases', () => {
  let app;
  let db;
  let userId;
  let auth;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'phase@test.test').id;
    auth = authHeader(db, userId);
  });

  describe('/api/diet-phases', () => {
    it('creates, lists, edits and soft-deletes', async () => {
      const created = await request(app).post('/api/diet-phases').set(auth)
        .send({ kind: 'bulk', start_date: '2026-09-01', label: 'Fall bulk' }).expect(201);
      expect(created.body).toMatchObject({ kind: 'bulk', label: 'Fall bulk', end_date: null, source: 'app' });

      const listed = await request(app).get('/api/diet-phases?start=2026-09-01&end=2026-09-30&today=2026-09-20')
        .set(auth).expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0]).toMatchObject({ ongoing: true, effective_end_date: '2026-09-20' });

      await request(app).put(`/api/diet-phases/${created.body.id}`).set(auth)
        .send({ end_date: '2026-09-10' }).expect(200);
      const after = await request(app).get('/api/diet-phases?today=2026-09-20').set(auth);
      expect(after.body[0]).toMatchObject({ ongoing: false, effective_end_date: '2026-09-10' });

      await request(app).delete(`/api/diet-phases/${created.body.id}`).set(auth).expect(204);
      expect((await request(app).get('/api/diet-phases').set(auth)).body).toEqual([]);
      expect(db.prepare('SELECT is_deleted FROM diet_phases WHERE id = ?').get(created.body.id).is_deleted).toBe(1);
    });

    it('the name is free text and required; kind is an optional color', async () => {
      const r = await request(app).post('/api/diet-phases').set(auth)
        .send({ label: 'No-alcohol month', start_date: '2026-09-01' }).expect(201);
      expect(r.body).toMatchObject({ label: 'No-alcohol month', kind: 'other' });
      await request(app).post('/api/diet-phases').set(auth).send({ kind: 'cut', start_date: '2026-09-01' }).expect(400);
      await request(app).put(`/api/diet-phases/${r.body.id}`).set(auth).send({ label: '  ' }).expect(400);
    });

    it('validates kind, dates and order', async () => {
      await request(app).post('/api/diet-phases').set(auth).send({ label: 'L', kind: 'keto', start_date: '2026-09-01' }).expect(400);
      await request(app).post('/api/diet-phases').set(auth).send({ label: 'L', kind: 'cut', start_date: '2026-02-30' }).expect(400);
      await request(app).post('/api/diet-phases').set(auth)
        .send({ label: 'L', kind: 'cut', start_date: '2026-09-10', end_date: '2026-09-01' }).expect(400);
    });

    it('keeps users apart', async () => {
      const other = createUser(db, 'other@test.test').id;
      const r = await request(app).post('/api/diet-phases').set(auth).send({ label: 'L', kind: 'cut', start_date: '2026-09-01' });
      expect((await request(app).get('/api/diet-phases').set(authHeader(db, other))).body).toEqual([]);
      await request(app).put(`/api/diet-phases/${r.body.id}`).set(authHeader(db, other)).send({ kind: 'bulk' }).expect(404);
      await request(app).delete(`/api/diet-phases/${r.body.id}`).set(authHeader(db, other)).expect(404);
    });
  });

  describe('ongoing resolution', () => {
    it('an open phase ends the day before the next open phase; bounded phases sit on top', () => {
      writes.addDietPhase(db, userId, { label: 'L', kind: 'bulk', start_date: '2026-06-01' });
      writes.addDietPhase(db, userId, { label: 'L', kind: 'maintenance', start_date: '2026-07-01', end_date: '2026-07-07' });
      writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-08-15' });
      const phases = listPhases(db, userId, { today: '2026-09-01' });
      expect(phases.map(p => [p.kind, p.effective_end_date, p.ongoing])).toEqual([
        ['bulk', '2026-08-14', false],
        ['maintenance', '2026-07-07', false],
        ['cut', '2026-09-01', true],
      ]);
      expect(listPhases(db, userId, { start: '2026-07-03', end: '2026-07-03', today: '2026-09-01' }).map(p => p.kind))
        .toEqual(['bulk', 'maintenance']);
    });
  });

  describe('MCP', () => {
    it('add shows in get_diet_phases and get_day, flagged source=mcp, revert removes it', () => {
      const r = writes.addDietPhase(db, userId, { kind: 'cut', start_date: '2026-09-01', label: 'Summer cut' });
      expect(r.error).toBeUndefined();
      expect(r.audit_id).toBeTruthy();
      expect(r.diet_phase).toMatchObject({ kind: 'cut', source: 'mcp', label: 'Summer cut' });

      expect(reads.getDietPhases(db, userId, { date: '2026-09-02' }).phases.map(p => p.id)).toEqual([r.diet_phase.id]);
      expect(reads.getDay(db, userId, '2026-09-02').diet_phases[0]).toMatchObject({ kind: 'cut' });
      expect(writes.listRecentMcpWrites(db, userId).diet_phases.map(p => p.id)).toEqual([r.diet_phase.id]);

      expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).ok).toBe(true);
      expect(reads.getDietPhases(db, userId).phases).toEqual([]);
    });

    it('update moves a phase and revert restores it; reopen with end_date null', () => {
      const id = writes.addDietPhase(db, userId, { label: 'L', kind: 'bulk', start_date: '2026-09-01', end_date: '2026-09-30' })
        .diet_phase.id;
      const u = writes.updateDietPhase(db, userId, { diet_phase_id: id, start_date: '2026-09-05', kind: 'maintenance' });
      expect(u.after).toMatchObject({ start_date: '2026-09-05', kind: 'maintenance', end_date: '2026-09-30' });
      expect(u.before).toMatchObject({ start_date: '2026-09-01', kind: 'bulk' });

      writes.revertMcpWrite(db, userId, { audit_id: u.audit_id });
      expect(reads.getDietPhases(db, userId).phases[0]).toMatchObject({ start_date: '2026-09-01', kind: 'bulk' });

      const reopened = writes.updateDietPhase(db, userId, { diet_phase_id: id, end_date: null });
      expect(reopened.after.end_date).toBeNull();
    });

    it('delete is soft and revertible', () => {
      const id = writes.addDietPhase(db, userId, { label: 'L', kind: 'recovery', start_date: '2026-09-01' }).diet_phase.id;
      const d = writes.deleteDietPhase(db, userId, { diet_phase_id: id });
      expect(reads.getDietPhases(db, userId).phases).toEqual([]);
      writes.revertMcpWrite(db, userId, { audit_id: d.audit_id });
      expect(reads.getDietPhases(db, userId).phases.map(p => p.id)).toEqual([id]);
    });

    it('refuses to revert a phase edited in the app since', async () => {
      const r = writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-09-01' });
      await request(app).put(`/api/diet-phases/${r.diet_phase.id}`).set(auth).send({ label: 'Mine now' }).expect(200);
      expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).code).toBe('NOT_REVERTIBLE');
    });

    it('refuses unknown params, bad input, and other users\' phases', () => {
      expect(writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-09-01', color: 'red' }).code)
        .toBe('UNKNOWN_PARAM');
      expect(writes.addDietPhase(db, userId, { label: 'L', kind: 'keto', start_date: '2026-09-01' }).error).toMatch(/kind/);
      const id = writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-09-01' }).diet_phase.id;
      const other = createUser(db, 'x@test.test').id;
      expect(writes.updateDietPhase(db, other, { diet_phase_id: id, kind: 'bulk' }).code).toBe('NOT_FOUND');
      expect(writes.deleteDietPhase(db, other, { diet_phase_id: id }).code).toBe('NOT_FOUND');
    });

    it('works inside write_batch and the batch reverts as one', () => {
      const b = writes.writeBatch(db, userId, {
        operations: [
          { label: 'L', op: 'add_diet_phase', kind: 'bulk', start_date: '2026-09-01' },
          { label: 'L', op: 'add_diet_phase', kind: 'maintenance', start_date: '2026-09-20', end_date: '2026-09-27' },
        ],
      });
      expect(b.error).toBeUndefined();
      expect(b.result_row_ids.diet_phase_ids).toHaveLength(2);
      writes.revertMcpWrite(db, userId, { audit_id: b.audit_id });
      expect(reads.getDietPhases(db, userId).phases).toEqual([]);
    });

    it('warns on a same-name same-day duplicate', () => {
      writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-09-01' });
      const r = writes.addDietPhase(db, userId, { label: 'L', kind: 'cut', start_date: '2026-09-01' });
      expect(r.warnings[0]).toMatch(/possible duplicate/);
    });
  });
});
