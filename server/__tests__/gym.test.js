const request = require('supertest');
const { buildTestApp } = require('./helpers');

describe('/api/gym', () => {
  it('seeds a catalog and lets a user create a custom exercise', async () => {
    const { app } = buildTestApp();
    const list = await request(app).get('/api/gym/exercises');
    expect(list.status).toBe(200);
    expect(list.body.find(e => e.name === 'Barbell Back Squat')).toBeTruthy();

    const created = await request(app).post('/api/gym/exercises').send({
      name: 'Jefferson Curl',
      primary_muscle: 'hamstrings',
      movement_type: 'legs',
    });
    expect(created.status).toBe(201);
    expect(created.body.is_custom).toBe(true);
  });

  it('builds a template, assigns the week, starts a session, and logs sets', async () => {
    const { app } = buildTestApp();
    const catalog = await request(app).get('/api/gym/exercises');
    const squat = catalog.body.find(e => e.name === 'Barbell Back Squat');

    const tmpl = await request(app).post('/api/gym/templates').send({
      name: 'Lower',
      split_label: 'lower',
      progression_notes: 'Add 5 lb when all sets hit.',
    });
    expect(tmpl.status).toBe(201);

    const item = await request(app)
      .post(`/api/gym/templates/${tmpl.body.id}/exercises`)
      .send({ exercise_id: squat.id, target_sets: 3, target_reps: 5, target_weight: 185, rest_sec: 90 });
    expect(item.status).toBe(201);
    expect(item.body.target_reps).toBe(5);

    const days = [];
    for (let w = 1; w <= 7; w += 1) {
      days.push({ weekday: w, enabled: w === 5, template_id: w === 5 ? tmpl.body.id : null, duration_min: 60 });
    }
    const sched = await request(app).put('/api/gym/schedule').send({ days });
    expect(sched.status).toBe(200);
    expect(sched.body.find(d => d.weekday === 5).template_id).toBe(tmpl.body.id);

    // 2026-08-21 is a Friday
    const today = await request(app).get('/api/gym/today?date=2026-08-21');
    expect(today.status).toBe(200);
    expect(today.body.template.name).toBe('Lower');

    const session = await request(app).post('/api/gym/sessions').send({
      date: '2026-08-21',
      template_id: tmpl.body.id,
      activity_type: 'strength',
    });
    expect(session.status).toBe(201);

    const set1 = await request(app).post(`/api/gym/sessions/${session.body.id}/sets`).send({
      exercise_id: squat.id,
      reps: 5,
      weight: 185,
      weight_unit: 'lb',
    });
    expect(set1.status).toBe(201);
    expect(set1.body.set_index).toBe(1);

    const set2 = await request(app).post(`/api/gym/sessions/${session.body.id}/sets`).send({
      exercise_id: squat.id,
      reps: 5,
      weight: 185,
      weight_unit: 'lb',
    });
    expect(set2.body.set_index).toBe(2);

    const finished = await request(app).put(`/api/gym/sessions/${session.body.id}`).send({ finish: true });
    expect(finished.status).toBe(200);
    expect(finished.body.ended_at).toBeTruthy();
    expect(finished.body.sets).toHaveLength(2);

    const progress = await request(app).get(`/api/gym/progress?exercise_id=${squat.id}&window=ALL`);
    expect(progress.status).toBe(200);
    expect(progress.body.daily).toHaveLength(1);
    expect(progress.body.daily[0].sets).toBe(2);

    const orm = await request(app).put(`/api/gym/one-rm/${squat.id}`).send({
      estimated: 220,
      formula: 'epley',
    });
    expect(orm.status).toBe(200);
    expect(orm.body.estimated).toBe(220);
  });

  it('logs a duration-only activity session', async () => {
    const { app } = buildTestApp();
    const types = await request(app).get('/api/gym/activity-types');
    expect(types.body.find(t => t.id === 'tennis')).toBeTruthy();

    const session = await request(app).post('/api/gym/sessions').send({
      date: '2026-08-22',
      activity_type: 'tennis',
    });
    expect(session.status).toBe(201);

    const done = await request(app).put(`/api/gym/sessions/${session.body.id}`).send({
      finish: true,
      duration_sec: 3600,
      activity_type: 'tennis',
    });
    expect(done.body.activity_type).toBe('tennis');
    expect(done.body.duration_sec).toBe(3600);
  });
});
