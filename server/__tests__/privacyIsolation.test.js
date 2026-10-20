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
const { buildTestApp, listenTestServer, closeTestServer, authHeader, createUser } = require('./helpers');
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
async function seedUser(server, db, user, tag) {
  const h = authHeader(db, user.id);
  const api = () => request(server);

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
  let server;
  let db;
  let alice;
  let bob;
  let A;
  let B;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    server = await listenTestServer(app);
    alice = createUser(db, 'alice@privacy.test');
    bob = createUser(db, 'bob@privacy.test');
    A = await seedUser(server, db, alice, 'Alice');
    B = await seedUser(server, db, bob, 'Bob');
  });

  afterEach(() => closeTestServer(server));

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
      const res = await request(server).get(path).set(B.h);
      expect({ path, leaked: bodyText(res).includes('Alice') }).toEqual({ path, leaked: false });
    }
    // Control: the same probe does see A's rows when A asks, so the check above can fail.
    const own = await request(server).get('/api/recipes').set(A.h);
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
      const res = await request(server).get(path).set(B.h);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(bodyText(res)).not.toContain('Alice');
    }
    const oneRm = await request(server).get(`/api/gym/one-rm/${A.exerciseId}`).set(B.h);
    expect(oneRm.body.estimated).toBeNull();
    const progress = await request(server).get(`/api/gym/progress?exercise_id=${A.exerciseId}`).set(B.h);
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
      const res = await request(server)[method](path).set(B.h).send(body);
      const accepted = method !== 'post' && res.status >= 200 && res.status < 300;
      expect({ method, path, accepted }).toEqual({ method, path, accepted: false });
    }
    expect(snapshot(db, alice.id)).toEqual(before);
  });

  it('B cannot use A\'s recipe, ingredient or template as a source for B\'s own writes', async () => {
    const logRecipe = await request(server).post('/api/log').set(B.h)
      .send({ recipe_id: A.recipeId, date: DAY, servings: 1 });
    expect(logRecipe.status).toBe(404);

    const session = await request(server).post('/api/gym/sessions').set(B.h)
      .send({ date: '2026-08-04', template_id: A.templateId });
    expect(session.status).toBe(400);

    const addToOwn = await request(server).post(`/api/gym/templates/${B.templateId}/exercises`).set(B.h)
      .send({ exercise_id: A.exerciseId });
    expect(addToOwn.status).toBe(400);

    const setOnOwn = await request(server).post(`/api/gym/sessions/${B.sessionId}/sets`).set(B.h)
      .send({ exercise_id: A.exerciseId, reps: 5, weight: 100 });
    expect(setOnOwn.status).toBe(400);
  });

  it('body-weight delete by date only removes the caller\'s own row', async () => {
    await request(server).delete(`/api/body-weights/${DAY}`).set(B.h).expect(204);
    const aliceWeights = await request(server).get('/api/body-weights').set(A.h);
    expect(aliceWeights.body).toEqual([expect.objectContaining({ date: DAY, weight_kg: 80 })]);
  });

  it('a request with an invalid token is rejected, not served as another user', async () => {
    const prevJest = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(server).get('/api/recipes').set({ Authorization: 'Bearer not-a-real-token' });
      expect(res.status).toBe(401);
      expect(bodyText(res)).not.toContain('Alice');
    } finally {
      process.env.JEST_WORKER_ID = prevJest;
    }
  });
});

describe('privacy isolation — MCP tools', () => {
  let app;
  let server;
  let db;
  let alice;
  let bob;
  let A;
  let B;
  let aliceAudit;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    server = await listenTestServer(app);
    alice = createUser(db, 'alice@mcp-privacy.test');
    bob = createUser(db, 'bob@mcp-privacy.test');
    A = await seedUser(server, db, alice, 'Alice');
    B = await seedUser(server, db, bob, 'Bob');
    const w = writes.logBodyWeight(db, alice.id, { weight: 81, unit: 'kg', date: '2026-08-04' });
    expect(w.error).toBeUndefined();
    aliceAudit = w.audit_id;
  });

  afterEach(() => closeTestServer(server));

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
  let server;
  let db;
  let coach;
  let client;
  let stranger;
  let coachH;
  let clientH;

  async function link(scopes) {
    const invite = await request(server).get('/api/coach/invite-code').set(coachH);
    return request(server).post('/api/coach/link').set(clientH)
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
    server = await listenTestServer(app);
    coach = createUser(db, 'coach@privacy.test');
    client = createUser(db, 'client@privacy.test');
    stranger = createUser(db, 'stranger@privacy.test');
    coachH = authHeader(db, coach.id);
    clientH = authHeader(db, client.id);
    await request(server).patch('/api/auth/me').set(coachH).send({ is_coach: true, display_name: 'Coach' }).expect(200);
    await seedUser(server, db, client, 'Client');
    await seedUser(server, db, stranger, 'Stranger');
  });

  afterEach(() => closeTestServer(server));

  it('an unlinked coach gets nothing for anyone', async () => {
    for (const id of [client.id, stranger.id]) {
      for (const [method, path] of coachReads(id)) {
        const res = await request(server)[method](path).set(coachH).send({});
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
    }
    const roster = await request(server).get('/api/coach/roster').set(coachH);
    expect(roster.body).toEqual([]);
  });

  it('a linked coach reads only the linked client, never another user', async () => {
    await link({ scope_nutrition: true, scope_training: true, scope_weight: true });
    const ok = await request(server).get(coachReads(client.id)[0][1]).set(coachH);
    expect(ok.status).toBe(200);
    expect(bodyText(ok)).toContain('Client meal');

    for (const [method, path] of coachReads(stranger.id)) {
      const res = await request(server)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const roster = await request(server).get('/api/coach/roster').set(coachH);
    expect(roster.body.map(r => r.client_user_id)).toEqual([client.id]);
    expect(bodyText(roster)).not.toContain('Stranger');
  });

  it('a coach without the nutrition scope cannot read nutrition', async () => {
    await link({ scope_nutrition: false, scope_training: true, scope_weight: true });
    for (const [method, path] of coachReads(client.id)) {
      const res = await request(server)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const suggest = await request(server).post(`/api/coach/clients/${client.id}/suggestions`).set(coachH)
      .send({ for_date: DAY, note: 'eat more' });
    expect(suggest.status).toBe(403);

    const roster = await request(server).get('/api/coach/roster').set(coachH);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0].last_logged).toBeNull();
    expect(roster.body[0].summary_7d).toEqual([]);
    expect(bodyText(roster)).not.toContain('Client meal');
  });

  it('after revoke the coach reads nothing and the client leaves the roster', async () => {
    await link({ scope_nutrition: true });
    await request(server).post('/api/coach/revoke').set(clientH).send({ coach_user_id: coach.id }).expect(200);
    for (const [method, path] of coachReads(client.id)) {
      const res = await request(server)[method](path).set(coachH).send({});
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const roster = await request(server).get('/api/coach/roster').set(coachH);
    expect(roster.body).toEqual([]);
  });

  it('a coach link never opens the client\'s data through the regular /api routes', async () => {
    await link({ scope_nutrition: true, scope_training: true, scope_weight: true });
    for (const path of ['/api/recipes', `/api/log?date=${DAY}`, '/api/body-weights', '/api/gym/templates', '/api/supplements']) {
      const res = await request(server).get(path).set(coachH);
      expect({ path, leaked: bodyText(res).includes('Client') }).toEqual({ path, leaked: false });
    }
  });

  it('only the client can answer a coach suggestion addressed to them', async () => {
    await link({ scope_nutrition: true });
    const s = await request(server).post(`/api/coach/clients/${client.id}/suggestions`).set(coachH)
      .send({ for_date: DAY, note: 'more protein' });
    expect(s.status).toBe(201);

    const strangerH = authHeader(db, stranger.id);
    const inbox = await request(server).get('/api/coach/suggestions').set(strangerH);
    expect(inbox.body).toEqual([]);
    const patch = await request(server).patch(`/api/coach/suggestions/${s.body.id}`).set(strangerH)
      .send({ status: 'dismissed' });
    expect(patch.status).toBe(404);
    const coachPatch = await request(server).patch(`/api/coach/suggestions/${s.body.id}`).set(coachH)
      .send({ status: 'applied' });
    expect(coachPatch.status).toBe(404);
  });
});

/** Every array of rows anywhere in an export body, keyed by its path. */
function exportSections(body, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, exportSections(value, path));
  }
  return out;
}

describe('privacy isolation — data export (GET /api/me/export)', () => {
  let app;
  let server;
  let db;
  let alice;
  let bob;
  let A;
  let B;

  const EXPECTED_NONEMPTY = [
    'nutrition.log_entries',
    'nutrition.recipes',
    'nutrition.ingredients',
    'nutrition.supplements',
    'nutrition.supplement_checks',
    'nutrition.body_weights',
    'nutrition.diet_phases',
    'training.exercises',
    'training.templates',
    'training.template_exercises',
    'training.sessions',
    'training.sets',
    'training.one_rep_maxes',
    'mcp_writes',
  ];

  function expectOnlyOwnRows(body, ownerId, otherTag) {
    expect(body.account.id).toBe(ownerId);
    for (const [path, rows] of Object.entries(exportSections(body))) {
      for (const row of rows) {
        if ('user_id' in row) {
          expect({ path, user_id: row.user_id }).toEqual({ path, user_id: ownerId });
        }
      }
      expect({ path, leaked: JSON.stringify(rows).includes(otherTag) }).toEqual({ path, leaked: false });
    }
  }

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    server = await listenTestServer(app);
    alice = createUser(db, 'alice@export.test');
    bob = createUser(db, 'bob@export.test');
    A = await seedUser(server, db, alice, 'Alice');
    B = await seedUser(server, db, bob, 'Bob');
    for (const [user, tag] of [[alice, 'Alice'], [bob, 'Bob']]) {
      const h = authHeader(db, user.id);
      await request(server).put('/api/goals').set(h)
        .send({ effective_start_date: '2026-08-01', goals: [{ weekday: 1, calories_min: 2000, calories_max: 2400 }] })
        .expect(200);
      await request(server).put('/api/profile').set(h).send({ height_cm: tag === 'Alice' ? 170 : 190 }).expect(200);
      const w = writes.logBodyWeight(db, user.id, { weight: 81, unit: 'kg', date: '2026-08-04' });
      expect(w.error).toBeUndefined();
    }
  });

  afterEach(() => closeTestServer(server));

  it('A\'s export holds every section of A\'s data and none of B\'s rows', async () => {
    const res = await request(server).get('/api/me/export').set(A.h);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="flops-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const sections = exportSections(res.body);
    for (const path of EXPECTED_NONEMPTY) {
      expect({ path, rows: sections[path]?.length > 0 }).toEqual({ path, rows: true });
    }
    expect(res.body.nutrition.goals.versions.length).toBeGreaterThan(0);
    expect(res.body.nutrition.profile.user_id).toBe(alice.id);
    expect(res.body.nutrition.profile.height_cm).toBe(170);
    expect(JSON.stringify(res.body)).toContain('Alice');
    expectOnlyOwnRows(res.body, alice.id, 'Bob');
  });

  it('B\'s export holds none of A\'s rows', async () => {
    const res = await request(server).get('/api/me/export').set(B.h);
    expect(res.status).toBe(200);
    expect(res.body.nutrition.profile.height_cm).toBe(190);
    expectOnlyOwnRows(res.body, bob.id, 'Alice');
    const ids = exportSections(res.body);
    expect(ids['nutrition.recipes'].map(r => r.id)).not.toContain(A.recipeId);
    expect(ids['nutrition.log_entries'].map(r => r.id)).not.toContain(A.entryId);
    expect(ids['training.sets'].map(r => r.id)).not.toContain(A.setId);
  });

  it('soft-deleted rows stay out of the export', async () => {
    await request(server).delete(`/api/recipes/${A.recipeId}`).set(A.h).expect(204);
    await request(server).delete(`/api/log/${A.entryId}`).set(A.h).expect(204);
    await request(server).delete(`/api/diet-phases/${A.phaseId}`).set(A.h);
    await request(server).delete(`/api/supplements/${A.supplementId}`).set(A.h);
    await request(server).delete(`/api/gym/templates/${A.templateId}`).set(A.h);
    const res = await request(server).get('/api/me/export').set(A.h);
    const s = exportSections(res.body);
    expect(s['nutrition.recipes'].map(r => r.id)).not.toContain(A.recipeId);
    expect(s['nutrition.log_entries'].map(r => r.id)).not.toContain(A.entryId);
    expect(s['nutrition.diet_phases'].map(r => r.id)).not.toContain(A.phaseId);
    expect(s['nutrition.supplements'].map(r => r.id)).not.toContain(A.supplementId);
    expect(s['nutrition.supplement_checks']).toEqual([]);
    expect(s['training.templates'].map(r => r.id)).not.toContain(A.templateId);
    expect(s['training.template_exercises']).toEqual([]);
  });

  it('an unauthenticated request gets 401 and no data', async () => {
    const prevJest = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const none = await request(server).get('/api/me/export');
      expect(none.status).toBe(401);
      const bad = await request(server).get('/api/me/export').set({ Authorization: 'Bearer not-a-real-token' });
      expect(bad.status).toBe(401);
      for (const res of [none, bad]) {
        expect(bodyText(res)).not.toMatch(/Alice|Bob/);
      }
    } finally {
      process.env.JEST_WORKER_ID = prevJest;
    }
  });

  it('a coach link does not widen either side\'s export', async () => {
    const coach = createUser(db, 'coach@export.test');
    const coachH = authHeader(db, coach.id);
    await request(server).patch('/api/auth/me').set(coachH).send({ is_coach: true, display_name: 'CoachName' }).expect(200);
    const invite = await request(server).get('/api/coach/invite-code').set(coachH);
    await request(server).post('/api/coach/link').set(A.h)
      .send({ invite_code: invite.body.invite_code, scope_nutrition: true, scope_training: true, scope_weight: true })
      .expect(201);

    const coachExport = await request(server).get('/api/me/export').set(coachH);
    expect(coachExport.status).toBe(200);
    expectOnlyOwnRows(coachExport.body, coach.id, 'Alice');
    expect(coachExport.body.coach_links).toEqual([
      expect.objectContaining({ coach_user_id: coach.id, client_user_id: alice.id, role: 'coach', scope_nutrition: 1 }),
    ]);
    expect(Object.keys(coachExport.body.coach_links[0]).sort()).toEqual([
      'client_user_id', 'coach_user_id', 'created_at', 'id', 'role',
      'scope_nutrition', 'scope_training', 'scope_weight', 'status',
    ]);
    expect(bodyText(coachExport)).not.toContain('alice@export.test');

    const clientExport = await request(server).get('/api/me/export').set(A.h);
    expectOnlyOwnRows(clientExport.body, alice.id, 'Bob');
    expect(clientExport.body.coach_links).toEqual([
      expect.objectContaining({ coach_user_id: coach.id, client_user_id: alice.id, role: 'client' }),
    ]);
    expect(bodyText(clientExport)).not.toMatch(/CoachName|coach@export\.test/);

    const bobExport = await request(server).get('/api/me/export').set(B.h);
    expect(bobExport.body.coach_links).toEqual([]);
  });
});
