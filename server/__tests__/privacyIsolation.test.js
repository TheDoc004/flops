/**
 * Cross-user privacy isolation: user B (and a coach) must never read, change or
 * delete user A's rows — through the REST API or the MCP tool functions.
 *
 * Every attack runs against a snapshot of A's rows taken before it; the snapshot
 * must be identical afterwards, so a "403 but wrote anyway" also fails.
 *
 * A test that exposes a real leak is skipped with a "PRIVACY GAP:" comment
 * rather than fixed here, so the district can turn it into a bug item.
 */
const request = require('supertest');
const { buildTestApp, authHeader, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

const DAY = '2026-08-03';

const USER_TABLES = [
  'recipes',
  'label_ingredients',
  'log_entries',
  'body_weights',
  'diet_phases',
  'supplements',
  'supplement_log',
  'gym_exercises',
  'gym_templates',
  'gym_template_exercises',
  'gym_sessions',
  'gym_sets',
  'gym_one_rep_maxes',
  'mcp_write_audit',
];

function snapshot(db, userId) {
  const out = {};
  for (const t of USER_TABLES) {
    out[t] = db.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY rowid`).all(userId);
  }
  return out;
}

/** Seeds one user's data through the same REST routes the app uses. */
async function seedUser(app, db, user, tag) {
  const h = authHeader(db, user.id);
  const api = () => request(app);

  const recipe = await api().post('/api/recipes').set(h).send({
    name: `${tag} Bowl`,
    serving_size: 1,
    calories: 500,
    protein_g: 40,
    carbs_g: 40,
    fat_g: 15,
    ingredients: [{ name: 'Chicken breast', amount: '100 g' }],
  });
  expect(recipe.status).toBe(201);

  const food = await api().post('/api/label-ingredients').set(h).send({
    name: `${tag} Oats`,
    serving_size_text: '40 g',
    grams_per_serving: 40,
    calories: 150,
    protein_g: 5,
    carbs_g: 27,
    fat_g: 3,
  });
  expect(food.status).toBe(201);

  const meal = await api().post('/api/log/custom').set(h).send({
    date: DAY, name: `${tag} meal`, servings: 1, calories: 400, protein_g: 30, carbs_g: 20, fat_g: 10,
  });
  expect(meal.status).toBe(201);

  await api().put('/api/body-weights').set(h).send({ date: DAY, weight_kg: 80 }).expect(200);

  const phase = await api().post('/api/diet-phases').set(h).send({
    label: `${tag} cut`, kind: 'cut', start_date: '2026-08-01',
  });
  expect(phase.status).toBe(201);

  const supp = await api().post('/api/supplements').set(h).send({ name: `${tag} Fish Oil`, dose_text: '2 softgels' });
  expect(supp.status).toBe(201);
  await api().put('/api/supplements/log').set(h).send({ date: DAY, supplement_id: supp.body.id, taken: 1 }).expect(200);

  const ex = await api().post('/api/gym/exercises').set(h).send({ name: `${tag} Press`, primary_muscle: 'chest' });
  expect([200, 201]).toContain(ex.status);
  const tpl = await api().post('/api/gym/templates').set(h).send({ name: `${tag} Push` });
  expect(tpl.status).toBe(201);
  const item = await api().post(`/api/gym/templates/${tpl.body.id}/exercises`).set(h)
    .send({ exercise_id: ex.body.id, target_sets: 3 });
  expect(item.status).toBe(201);
  const sess = await api().post('/api/gym/sessions').set(h).send({ date: DAY, template_id: tpl.body.id });
  expect(sess.status).toBe(201);
  const set = await api().post(`/api/gym/sessions/${sess.body.id}/sets`).set(h)
    .send({ exercise_id: ex.body.id, reps: 5, weight: 185 });
  expect(set.status).toBe(201);
  await api().put(`/api/gym/one-rm/${ex.body.id}`).set(h).send({ estimated: 225 }).expect(200);

  return {
    h,
    recipeId: recipe.body.id,
    foodId: food.body.id,
    entryId: meal.body.id,
    phaseId: phase.body.id,
    supplementId: supp.body.id,
    exerciseId: ex.body.id,
    templateId: tpl.body.id,
    templateItemId: item.body.id,
    sessionId: sess.body.id,
    setId: set.body.id,
  };
}

function bodyText(res) {
  return JSON.stringify(res.body ?? '') + (res.text || '');
}

describe('privacy isolation — REST API', () => {
  let app;
  let db;
  let alice;
  let bob;
  let A;
  let B;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    alice = createUser(db, 'alice@privacy.test');
    bob = createUser(db, 'bob@privacy.test');
    A = await seedUser(app, db, alice, 'Alice');
    B = await seedUser(app, db, bob, 'Bob');
  });

  it('list/read endpoints never return the other user\'s rows', async () => {
    const reads = [
      '/api/recipes',
      '/api/recipes?include_archived=1&include_quick=1&include_deleted=1',
      '/api/label-ingredients',
      `/api/log?date=${DAY}`,
      `/api/log?start=2026-08-01&end=2026-08-05`,
      '/api/log/days',
      '/api/body-weights',
      '/api/diet-phases',
      '/api/supplements',
      `/api/supplements/today?date=${DAY}`,
      `/api/supplements/range?start=2026-08-01&end=2026-08-05`,
      '/api/gym/exercises',
      '/api/gym/templates',
      `/api/gym/today?date=${DAY}`,
      '/api/gym/schedule',
      `/api/gym/progress?exercise_id=${A.exerciseId}`,
      `/api/gym/one-rm/${A.exerciseId}`,
      '/api/mcp-writes/recent',
      '/api/prepped-batches',
    ];
    for (const path of reads) {
      const res = await request(app).get(path).set(B.h);
      expect({ path, leaked: bodyText(res).includes('Alice') }).toEqual({ path, leaked: false });
    }
    // Control: the same probe does see A's rows when A asks, so the check above can fail.
    const own = await request(app).get('/api/recipes').set(A.h);
    expect(bodyText(own)).toContain('Alice');
  });

  it('direct reads of A\'s ids are refused for B', async () => {
    const paths = [
      `/api/recipes/${A.recipeId}`,
      `/api/recipes/${A.recipeId}/nutrition`,
      `/api/label-ingredients/${A.foodId}`,
      `/api/gym/templates/${A.templateId}/exercises`,
    ];
    for (const path of paths) {
      const res = await request(app).get(path).set(B.h);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(bodyText(res)).not.toContain('Alice');
    }
    const oneRm = await request(app).get(`/api/gym/one-rm/${A.exerciseId}`).set(B.h);
    expect(oneRm.body.estimated).toBeNull();
    const progress = await request(app).get(`/api/gym/progress?exercise_id=${A.exerciseId}`).set(B.h);
    expect(progress.body.sets).toEqual([]);
  });

  it('B cannot update or delete A\'s rows (A\'s data is byte-for-byte unchanged)', async () => {
    const before = snapshot(db, alice.id);
    const attempts = [
      ['put', `/api/recipes/${A.recipeId}`, { name: 'pwned', serving_size: 1, calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1, ingredients: [] }],
      ['post', `/api/recipes/${A.recipeId}/reactivate`, {}],
      ['delete', `/api/recipes/${A.recipeId}`],
      ['put', `/api/label-ingredients/${A.foodId}`, { name: 'pwned', serving_size_text: '1 g', grams_per_serving: 1, calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }],
      ['post', '/api/label-ingredients/used', { id: A.foodId, ids: [A.foodId] }],
      ['delete', `/api/label-ingredients/${A.foodId}`],
      ['put', `/api/log/${A.entryId}`, { servings: 9, notes: 'pwned' }],
      ['delete', `/api/log/${A.entryId}`],
      ['put', `/api/diet-phases/${A.phaseId}`, { label: 'pwned' }],
      ['delete', `/api/diet-phases/${A.phaseId}`],
      ['put', `/api/supplements/${A.supplementId}`, { name: 'pwned' }],
      ['put', '/api/supplements/log', { date: DAY, supplement_id: A.supplementId, taken: 0 }],
      ['delete', `/api/supplements/${A.supplementId}`],
      ['put', `/api/gym/templates/${A.templateId}`, { name: 'pwned' }],
      ['delete', `/api/gym/templates/${A.templateId}`],
      ['post', `/api/gym/templates/${A.templateId}/exercises`, { exercise_id: B.exerciseId }],
      ['put', `/api/gym/templates/${A.templateId}/exercises/${A.templateItemId}`, { target_sets: 9 }],
      ['delete', `/api/gym/templates/${A.templateId}/exercises/${A.templateItemId}`],
      ['put', `/api/gym/sessions/${A.sessionId}`, { finish: true, notes: 'pwned' }],
      ['post', `/api/gym/sessions/${A.sessionId}/sets`, { exercise_id: B.exerciseId, reps: 1, weight: 1 }],
      ['delete', `/api/gym/sessions/${A.sessionId}/sets/${A.setId}`],
      ['put', `/api/gym/one-rm/${A.exerciseId}`, { estimated: 1 }],
      ['post', '/api/mcp-writes/bulk-delete', { log_entry_ids: [A.entryId], label_ingredient_ids: [A.foodId] }],
    ];
    // POST endpoints may answer 200 with nothing to do; the snapshot is what proves them.
    for (const [method, path, body] of attempts) {
      const res = await request(app)[method](path).set(B.h).send(body);
      const accepted = method !== 'post' && res.status >= 200 && res.status < 300;
      expect({ method, path, accepted }).toEqual({ method, path, accepted: false });
    }
    expect(snapshot(db, alice.id)).toEqual(before);
  });

  it('B cannot use A\'s recipe, ingredient or template as a source for B\'s own writes', async () => {
    const logRecipe = await request(app).post('/api/log').set(B.h)
      .send({ recipe_id: A.recipeId, date: DAY, servings: 1 });
    expect(logRecipe.status).toBe(404);

    const session = await request(app).post('/api/gym/sessions').set(B.h)
      .send({ date: '2026-08-04', template_id: A.templateId });
    expect(session.status).toBe(400);

    const addToOwn = await request(app).post(`/api/gym/templates/${B.templateId}/exercises`).set(B.h)
      .send({ exercise_id: A.exerciseId });
    expect(addToOwn.status).toBe(400);

    const setOnOwn = await request(app).post(`/api/gym/sessions/${B.sessionId}/sets`).set(B.h)
      .send({ exercise_id: A.exerciseId, reps: 5, weight: 100 });
    expect(setOnOwn.status).toBe(400);
  });

  it('body-weight delete by date only removes the caller\'s own row', async () => {
    await request(app).delete(`/api/body-weights/${DAY}`).set(B.h).expect(204);
    const aliceWeights = await request(app).get('/api/body-weights').set(A.h);
    expect(aliceWeights.body).toEqual([expect.objectContaining({ date: DAY, weight_kg: 80 })]);
  });

  it('a request with an invalid token is rejected, not served as another user', async () => {
    const prevJest = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app).get('/api/recipes').set({ Authorization: 'Bearer not-a-real-token' });
      expect(res.status).toBe(401);
      expect(bodyText(res)).not.toContain('Alice');
    } finally {
      process.env.JEST_WORKER_ID = prevJest;
    }
  });
});

describe('privacy isolation — MCP tools', () => {
  let app;
  let db;
  let alice;
  let bob;
  let A;
  let B;
  let aliceAudit;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    alice = createUser(db, 'alice@mcp-privacy.test');
    bob = createUser(db, 'bob@mcp-privacy.test');
    A = await seedUser(app, db, alice, 'Alice');
    B = await seedUser(app, db, bob, 'Bob');
    const w = writes.logBodyWeight(db, alice.id, { weight: 81, unit: 'kg', date: '2026-08-04' });
    expect(w.error).toBeUndefined();
    aliceAudit = w.audit_id;
  });

  it('read tools scoped to B never return A\'s data', () => {
    const outputs = [
      reads.getDay(db, bob.id, DAY),
      reads.getLogEntries(db, bob.id, { start: '2026-08-01', end: '2026-08-05' }),
      reads.getBodyWeights(db, bob.id, '2026-08-01', '2026-08-05'),
      reads.getProfile(db, bob.id),
      reads.getSupplementsRange(db, bob.id, '2026-08-01', '2026-08-05'),
      reads.getMicronutrientTotals(db, bob.id, '2026-08-01', '2026-08-05'),
      reads.searchRecipes(db, bob.id, 'Alice'),
      reads.searchRecipes(db, bob.id, ''),
      reads.searchIngredients(db, bob.id, 'Alice'),
      reads.searchIngredients(db, bob.id, ''),
      reads.listSupplements(db, bob.id, { include_deleted: true }),
      reads.getGymToday(db, bob.id, DAY),
      reads.getGymProgress(db, bob.id, { exercise_id: A.exerciseId }),
      reads.getDietPhases(db, bob.id, { start: '2026-08-01', end: '2026-08-31' }),
      writes.listRecentMcpWrites(db, bob.id, 90),
    ];
    for (const [i, out] of outputs.entries()) {
      expect({ i, leaked: JSON.stringify(out ?? null).includes('Alice') }).toEqual({ i, leaked: false });
    }
    expect(JSON.stringify(reads.searchRecipes(db, alice.id, 'Alice'))).toContain('Alice');
  });

  it('get_recipe / get_ingredient with A\'s ids return nothing of A\'s for B', () => {
    const recipe = reads.getRecipe(db, bob.id, A.recipeId);
    expect(JSON.stringify(recipe ?? null)).not.toContain('Alice');
    const food = reads.getIngredient(db, bob.id, A.foodId);
    expect(JSON.stringify(food ?? null)).not.toContain('Alice');
  });

  it('write tools scoped to B cannot change A\'s rows', () => {
    const before = snapshot(db, alice.id);
    const attempts = [
      writes.updateFoodItem(db, bob.id, { label_ingredient_id: A.foodId, name: 'pwned' }),
      writes.updateMealEntry(db, bob.id, { log_entry_id: A.entryId, name: 'pwned' }),
      writes.deleteMealEntry(db, bob.id, { log_entry_id: A.entryId }),
      writes.updateSupplement(db, bob.id, { supplement_id: A.supplementId, dose_text: 'pwned' }),
      writes.updateSupplement(db, bob.id, { supplement_id: A.supplementId, taken: false, taken_date: DAY }),
      writes.updateRecipe(db, bob.id, { recipe_id: A.recipeId, name: 'pwned' }),
      writes.updateDietPhase(db, bob.id, { diet_phase_id: A.phaseId, label: 'pwned' }),
      writes.deleteDietPhase(db, bob.id, { diet_phase_id: A.phaseId }),
    ];
    for (const [i, r] of attempts.entries()) {
      expect({ i, refused: !!r?.error }).toEqual({ i, refused: true });
    }
    writes.bulkDeleteMcpLogEntries(db, bob.id, [A.entryId]);
    writes.bulkDeleteMcpFoods(db, bob.id, [A.foodId]);
    expect(snapshot(db, alice.id)).toEqual(before);
  });

  it('B cannot log A\'s recipe or ingredient through log_meal / create_meal_prep', () => {
    const before = snapshot(db, alice.id);
    const viaRecipe = writes.logMeal(db, bob.id, {
      date: DAY, name: 'x', weight_basis: 'cooked', items: [{ recipe_id: A.recipeId, servings: 1 }],
    });
    expect(viaRecipe.error).toBeTruthy();
    const viaFood = writes.logMeal(db, bob.id, {
      date: DAY, name: 'x', weight_basis: 'raw',
      items: [{ label_ingredient_id: A.foodId, quantity_g: 40, nutrition_source: 'label' }],
    });
    expect(viaFood.error).toBeTruthy();
    const prep = writes.createMealPrep(db, bob.id, {
      name: 'x', servings: 2, weight_basis: 'raw',
      items: [{ label_ingredient_id: A.foodId, quantity_g: 80, nutrition_source: 'label' }],
    });
    expect(prep.error).toBeTruthy();
    expect(snapshot(db, alice.id)).toEqual(before);
  });

  it('write_batch targeting A\'s ids fails as a whole and writes nothing anywhere', () => {
    const aliceBefore = snapshot(db, alice.id);
    const bobBefore = snapshot(db, bob.id);
    const r = writes.writeBatch(db, bob.id, {
      operations: [
        { op: 'log_body_weight', weight: 90, unit: 'kg', date: '2026-08-05' },
        { op: 'update_food_item', label_ingredient_id: A.foodId, name: 'pwned' },
        { op: 'delete_meal_entry', log_entry_id: A.entryId },
        { op: 'update_diet_phase', diet_phase_id: A.phaseId, label: 'pwned' },
      ],
    });
    expect(r.error).toBeTruthy();
    expect(snapshot(db, alice.id)).toEqual(aliceBefore);
    expect(snapshot(db, bob.id)).toEqual(bobBefore);
  });

  it('revert_mcp_write cannot undo another user\'s audit entry', () => {
    const before = snapshot(db, alice.id);
    const r = writes.revertMcpWrite(db, bob.id, { audit_id: aliceAudit });
    expect(r.error).toMatch(/not found/);
    expect(snapshot(db, alice.id)).toEqual(before);

    const own = writes.revertMcpWrite(db, alice.id, { audit_id: aliceAudit });
    expect(own.ok).toBe(true);
  });

  it('a batch B writes and reverts only touches B\'s rows', () => {
    const aliceBefore = snapshot(db, alice.id);
    const batch = writes.writeBatch(db, bob.id, {
      operations: [
        { op: 'log_body_weight', weight: 90, unit: 'kg', date: DAY },
        { op: 'add_diet_phase', label: 'Bob bulk', kind: 'bulk', start_date: '2026-08-10' },
      ],
    });
    expect(batch.error).toBeUndefined();
    const rev = writes.revertMcpWrite(db, bob.id, { audit_id: batch.audit_id });
    expect(rev.ok).toBe(true);
    expect(snapshot(db, alice.id)).toEqual(aliceBefore);
  });
});

describe('privacy isolation — coach consent scopes', () => {
  let app;
  let db;
  let coach;
  let client;
  let stranger;
  let coachH;
  let clientH;

  async function link(scopes) {
    const invite = await request(app).get('/api/coach/invite-code').set(coachH);
    return request(app).post('/api/coach/link').set(clientH)
      .send({ invite_code: invite.body.invite_code, ...scopes })
      .expect(201);
  }

  const coachReads = id => [
    ['get', `/api/coach/clients/${id}/log?start=2026-08-01&end=2026-08-05`],
    ['post', `/api/coach/clients/${id}/weekly-summary`],
    ['get', `/api/coach/clients/${id}/suggestions`],
  ];

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    coach = createUser(db, 'coach@privacy.test');
    client = createUser(db, 'client@privacy.test');
    stranger = createUser(db, 'stranger@privacy.test');
    coachH = authHeader(db, coach.id);
    clientH = authHeader(db, client.id);
    await request(app).patch('/api/auth/me').set(coachH).send({ is_coach: true, display_name: 'Coach' }).expect(200);
    await seedUser(app, db, client, 'Client');
    await seedUser(app, db, stranger, 'Stranger');
  });

  it('an unlinked coach gets nothing for anyone', async () => {
    for (const id of [client.id, stranger.id]) {
      for (const [method, path] of coachReads(id)) {
        const res = await request(app)[method](path).set(coachH).send({});
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
    }
    const roster = await request(app).get('/api/coach/roster').set(coachH);
    expect(roster.body).toEqual([]);
  });

  it('a linked coach reads only the linked client, never another user', async () => {
    await link({ scope_nutrition: true, scope_training: true, scope_weight: true });
    const ok = await request(app).get(coachReads(client.id)[0][1]).set(coachH);
    expect(ok.status).toBe(200);
    expect(bodyText(ok)).toContain('Client meal');

    for (const [method, path] of coachReads(stranger.id)) {
      const res = await request(app)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const roster = await request(app).get('/api/coach/roster').set(coachH);
    expect(roster.body.map(r => r.client_user_id)).toEqual([client.id]);
    expect(bodyText(roster)).not.toContain('Stranger');
  });

  it('a coach without the nutrition scope cannot read nutrition', async () => {
    await link({ scope_nutrition: false, scope_training: true, scope_weight: true });
    for (const [method, path] of coachReads(client.id)) {
      const res = await request(app)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const suggest = await request(app).post(`/api/coach/clients/${client.id}/suggestions`).set(coachH)
      .send({ for_date: DAY, note: 'eat more' });
    expect(suggest.status).toBe(403);

    const roster = await request(app).get('/api/coach/roster').set(coachH);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0].last_logged).toBeNull();
    expect(roster.body[0].summary_7d).toEqual([]);
    expect(bodyText(roster)).not.toContain('Client meal');
  });

  it('after revoke the coach reads nothing and the client leaves the roster', async () => {
    await link({ scope_nutrition: true });
    await request(app).post('/api/coach/revoke').set(clientH).send({ coach_user_id: coach.id }).expect(200);
    for (const [method, path] of coachReads(client.id)) {
      const res = await request(app)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const roster = await request(app).get('/api/coach/roster').set(coachH);
    expect(roster.body).toEqual([]);
  });

  it('a coach link never opens the client\'s data through the regular /api routes', async () => {
    await link({ scope_nutrition: true, scope_training: true, scope_weight: true });
    for (const path of ['/api/recipes', `/api/log?date=${DAY}`, '/api/body-weights', '/api/gym/templates', '/api/supplements']) {
      const res = await request(app).get(path).set(coachH);
      expect({ path, leaked: bodyText(res).includes('Client') }).toEqual({ path, leaked: false });
    }
  });

  it('only the client can answer a coach suggestion addressed to them', async () => {
    await link({ scope_nutrition: true });
    const s = await request(app).post(`/api/coach/clients/${client.id}/suggestions`).set(coachH)
      .send({ for_date: DAY, note: 'more protein' });
    expect(s.status).toBe(201);

    const strangerH = authHeader(db, stranger.id);
    const inbox = await request(app).get('/api/coach/suggestions').set(strangerH);
    expect(inbox.body).toEqual([]);
    const patch = await request(app).patch(`/api/coach/suggestions/${s.body.id}`).set(strangerH)
      .send({ status: 'dismissed' });
    expect(patch.status).toBe(404);
    const coachPatch = await request(app).patch(`/api/coach/suggestions/${s.body.id}`).set(coachH)
      .send({ status: 'applied' });
    expect(coachPatch.status).toBe(404);
  });
});
