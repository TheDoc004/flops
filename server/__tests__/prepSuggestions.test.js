const request = require('supertest');
const { buildTestApp, authHeader, createUser } = require('./helpers');

describe('prep + coach suggestions', () => {
  it('lets a user plan ahead and soft-dismiss', async () => {
    const { app, db } = buildTestApp();
    const u = createUser(db, 'prepper@example.com');
    const h = authHeader(db, u.id);

    const created = await request(app)
      .post('/api/prep')
      .set(h)
      .send({
        date: '2026-08-20',
        payload: { name: 'Meal-prep chicken', servings: 1, calories: 250, protein_g: 40 },
      });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/prep?date=2026-08-20').set(h);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].payload.name).toBe('Meal-prep chicken');

    await request(app).delete(`/api/prep/${created.body.id}`).set(h).expect(200);
    const after = await request(app).get('/api/prep?date=2026-08-20').set(h);
    expect(after.body).toHaveLength(0);
  });

  it('coach suggestion applies into client prep without writing logs', async () => {
    const { app, db } = buildTestApp();
    const coach = createUser(db, 'c-suggest@example.com');
    const client = createUser(db, 'client-sug@example.com');

    await request(app)
      .patch('/api/auth/me')
      .set(authHeader(db, coach.id))
      .send({ is_coach: true });

    const invite = await request(app).get('/api/coach/invite-code').set(authHeader(db, coach.id));
    await request(app)
      .post('/api/coach/link')
      .set(authHeader(db, client.id))
      .send({ invite_code: invite.body.invite_code })
      .expect(201);

    const sug = await request(app)
      .post(`/api/coach/clients/${client.id}/suggestions`)
      .set(authHeader(db, coach.id))
      .send({
        for_date: '2026-08-21',
        note: 'Post-lift',
        payload: { slots: [{ name: 'Rice + chicken', protein_g: 45, calories: 500 }] },
      });
    expect(sug.status).toBe(201);

    const applied = await request(app)
      .patch(`/api/coach/suggestions/${sug.body.id}`)
      .set(authHeader(db, client.id))
      .send({ status: 'applied' });
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');

    const prep = await request(app)
      .get('/api/prep?date=2026-08-21')
      .set(authHeader(db, client.id));
    expect(prep.body.some(i => i.payload?.name === 'Rice + chicken')).toBe(true);

    const logs = await request(app)
      .get('/api/log?date=2026-08-21')
      .set(authHeader(db, client.id));
    expect(logs.body).toEqual([]);
  });
});
