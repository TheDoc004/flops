const request = require('supertest');
const { buildTestApp, authHeader, createUser } = require('./helpers');

function customMeal(name) {
  return {
    date: '2026-08-01',
    name,
    servings: 1,
    calories: 400,
    protein_g: 30,
    carbs_g: 20,
    fat_g: 10,
  };
}

describe('auth + per-user isolation', () => {
  it('isolates log entries between users', async () => {
    const { app, db } = buildTestApp();
    const a = createUser(db, 'alice@example.com');
    const b = createUser(db, 'bob@example.com');

    const created = await request(app)
      .post('/api/log/custom')
      .set(authHeader(db, a.id))
      .send(customMeal('Alice meal'));
    expect(created.status).toBe(201);

    const sneak = await request(app)
      .get('/api/log?date=2026-08-01')
      .set(authHeader(db, b.id));
    expect(sneak.status).toBe(200);
    expect(sneak.body).toEqual([]);

    const alice = await request(app)
      .get('/api/log?date=2026-08-01')
      .set(authHeader(db, a.id));
    expect(alice.body.length).toBe(1);
    expect(alice.body[0].recipe_name).toBe('Alice meal');
  });

  it('isolates recipes between users', async () => {
    const { app, db } = buildTestApp();
    const a = createUser(db, 'chef-a@example.com');
    const b = createUser(db, 'chef-b@example.com');

    const created = await request(app)
      .post('/api/recipes')
      .set(authHeader(db, a.id))
      .send({
        name: 'Secret Bowl',
        serving_size: 1,
        calories: 500,
        protein_g: 40,
        carbs_g: 40,
        fat_g: 15,
        ingredients: [{ name: 'Chicken breast', amount: '100 g' }],
      });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const listB = await request(app).get('/api/recipes').set(authHeader(db, b.id));
    expect(listB.body.find(r => r.id === id)).toBeUndefined();

    const getB = await request(app).get(`/api/recipes/${id}`).set(authHeader(db, b.id));
    expect(getB.status).toBe(404);

    const getA = await request(app).get(`/api/recipes/${id}`).set(authHeader(db, a.id));
    expect(getA.status).toBe(200);
    expect(getA.body.name).toBe('Secret Bowl');
  });

  it('email OTP login issues a session', async () => {
    const { app } = buildTestApp();
    const reqOtp = await request(app)
      .post('/api/auth/request-otp')
      .send({ email: 'otp@example.com' });
    expect(reqOtp.status).toBe(200);
    expect(reqOtp.body.dev_code).toMatch(/^\d{6}$/);

    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'otp@example.com', code: reqOtp.body.dev_code });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
    expect(verify.body.user.email).toBe('otp@example.com');

    const me = await request(app)
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${verify.body.token}` });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('otp@example.com');
  });

  it('coach cannot read client log until linked with consent', async () => {
    const { app, db } = buildTestApp();
    const coach = createUser(db, 'coach@example.com');
    const client = createUser(db, 'client@example.com');

    await request(app)
      .patch('/api/auth/me')
      .set(authHeader(db, coach.id))
      .send({ is_coach: true, display_name: 'Coach' });

    const meal = await request(app)
      .post('/api/log/custom')
      .set(authHeader(db, client.id))
      .send({ ...customMeal('Client bowl'), date: '2026-08-02' });
    expect(meal.status).toBe(201);

    const denied = await request(app)
      .get(`/api/coach/clients/${client.id}/log?start=2026-08-01&end=2026-08-03`)
      .set(authHeader(db, coach.id));
    expect(denied.status).toBe(403);

    const invite = await request(app)
      .get('/api/coach/invite-code')
      .set(authHeader(db, coach.id));
    expect(invite.body.invite_code).toBeTruthy();

    await request(app)
      .post('/api/coach/link')
      .set(authHeader(db, client.id))
      .send({ invite_code: invite.body.invite_code, scope_nutrition: true })
      .expect(201);

    const ok = await request(app)
      .get(`/api/coach/clients/${client.id}/log?start=2026-08-01&end=2026-08-03`)
      .set(authHeader(db, coach.id));
    expect(ok.status).toBe(200);
    expect(ok.body.some(r => r.recipe_name === 'Client bowl')).toBe(true);

    await request(app)
      .post('/api/coach/revoke')
      .set(authHeader(db, client.id))
      .send({ coach_user_id: coach.id });

    const after = await request(app)
      .get(`/api/coach/clients/${client.id}/log?start=2026-08-01&end=2026-08-03`)
      .set(authHeader(db, coach.id));
    expect(after.status).toBe(403);
  });
});
