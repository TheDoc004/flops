const request = require('supertest');
const { buildTestApp, createUser } = require('./helpers');
const reads = require('../mcp/reads');

describe('MCP /mcp auth', () => {
  let app;
  let db;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    createUser(db, 'owner@mcp.test');
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.MCP_API_TOKEN;
    else process.env.MCP_API_TOKEN = prevToken;
    if (prevUser === undefined) delete process.env.MCP_USER_ID;
    else process.env.MCP_USER_ID = prevUser;
  });

  it('returns 503 when MCP_API_TOKEN is unset', async () => {
    delete process.env.MCP_API_TOKEN;
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer anything')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/MCP_API_TOKEN/);
  });

  it('returns 401 without Bearer token', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong Bearer token', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer wrong')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
  });

  it('accepts initialize with x-api-key header', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('x-api-key', 'test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.result?.serverInfo?.name).toBe('flops');
  });

  it('accepts initialize with valid token', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      });
    expect(res.status).toBe(200);
    // enableJsonResponse → plain JSON body (not SSE)
    expect(res.body.result?.serverInfo?.name).toBe('flops');
    expect(res.body.result?.capabilities).toBeTruthy();
  });

  it('lists read-only tools after initialize', async () => {
    const listed = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.status).toBe(200);
    const names = (listed.body.result?.tools || []).map(t => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_server_info',
        'get_day',
        'get_log_range',
        'get_goals',
        'get_body_weights',
        'get_intake_weight_trend',
        'get_profile',
        'get_supplements_range',
        'get_micronutrient_totals',
        'search_recipes',
        'get_recipe',
        'search_ingredients',
        'get_ingredient',
        'list_supplements',
        'get_gym_today',
        'get_gym_progress',
        'log_meal',
        'add_food_item',
        'update_food_item',
        'update_meal_entry',
        'delete_meal_entry',
        'update_supplement',
        'create_meal_prep',
        'log_body_weight',
        'write_batch',
        'revert_mcp_write',
        'list_recent_mcp_writes',
      ])
    );
    expect(names).not.toEqual(expect.arrayContaining([
      'propose_meal_entry',
      'commit_proposal',
      'list_proposals',
      'discard_proposal',
    ]));
  });
});

describe('MCP search_ingredients batch', () => {
  let app;
  let db;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    const userId = createUser(db, 'owner@mcp.test').id;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
    const insert = db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g)
       VALUES (?, ?, '100 g', 100, 100, 1, 1, 1)`
    );
    for (const name of ['eggs', 'greek yogurt', 'clover honey']) insert.run(userId, name);
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.MCP_API_TOKEN;
    else process.env.MCP_API_TOKEN = prevToken;
    if (prevUser === undefined) delete process.env.MCP_USER_ID;
    else process.env.MCP_USER_ID = prevUser;
  });

  const call = args =>
    request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-mcp-secret-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_ingredients', arguments: args } });

  it('returns one result group per query', async () => {
    const res = await call({ queries: ['egg', 'yogurt', 'nope'] });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body.result.content[0].text);
    expect(body.results.map(r => r.query)).toEqual(['egg', 'yogurt', 'nope']);
    expect(body.results[0].ingredients.map(i => i.name)).toEqual(['eggs']);
    expect(body.results[1].ingredients.map(i => i.name)).toEqual(['greek yogurt']);
    expect(body.results[2].ingredients).toEqual([]);
  });

  it('still answers a single query in the old shape', async () => {
    const res = await call({ query: 'honey' });
    const body = JSON.parse(res.body.result.content[0].text);
    expect(body.query).toBe('honey');
    expect(body.ingredients.map(i => i.name)).toEqual(['clover honey']);
  });

  it('refuses query and queries together', async () => {
    const res = await call({ query: 'egg', queries: ['honey'] });
    expect(res.body.result.isError).toBe(true);
  });
});

describe('MCP reads helpers', () => {
  let db;
  let userId;

  beforeEach(() => {
    const built = buildTestApp();
    db = built.db;
    userId = createUser(db, 'reader@mcp.test').id;
    db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, is_quick_food)
       VALUES (?, 'Test Bowl', '1 bowl', 500, 40, 50, 15, 8, '[]', 0)`
    ).run(userId);
    const recipeId = db.prepare('SELECT id FROM recipes WHERE user_id = ?').get(userId).id;
    db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, servings, recipe_name, serving_size,
         recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food
       ) VALUES (?, ?, '2026-09-18', 1, 'Test Bowl', '1 bowl', 500, 40, 50, 15, 8, 0)`
    ).run(userId, recipeId);
    db.prepare(
      `INSERT INTO day_goal_versions (
         user_id, effective_start_date, weekday,
         calories_min, calories_max, protein_g_min, protein_g_max,
         carbs_g_min, carbs_g_max, fat_g_min, fat_g_max
       ) VALUES (?, '2026-01-01', 4, 1800, 2200, 140, 180, 180, 250, 50, 80)`
    ).run(userId);
    // Fill other weekdays so resolve still works
    for (const wd of [1, 2, 3, 5, 6, 7]) {
      db.prepare(
        `INSERT INTO day_goal_versions (
           user_id, effective_start_date, weekday,
           calories_min, calories_max, protein_g_min, protein_g_max,
           carbs_g_min, carbs_g_max, fat_g_min, fat_g_max
         ) VALUES (?, '2026-01-01', ?, 1800, 2200, 140, 180, 180, 250, 50, 80)`
      ).run(userId, wd);
    }
    db.prepare(
      'INSERT INTO body_weights (user_id, date, weight_kg) VALUES (?, ?, ?)'
    ).run(userId, '2026-09-18', 82.5);
  });

  it('get_day returns meals, totals, goals, weight', () => {
    const day = reads.getDay(db, userId, '2026-09-18');
    expect(day.meals).toHaveLength(1);
    expect(day.meal_totals.calories).toBe(500);
    expect(day.meal_totals.protein_g).toBe(40);
    expect(day.body_weight_kg).toBe(82.5);
    expect(day.goals.calories_min).toBe(1800);
    expect(day.vs_goals.calories.status).toBe('below');
  });

  it('get_log_range summaries stay user-scoped', () => {
    const other = createUser(db, 'other@mcp.test').id;
    const days = reads.getDailySummaries(db, userId, '2026-09-01', '2026-09-30');
    expect(days.some(d => d.date === '2026-09-18')).toBe(true);
    const otherDays = reads.getDailySummaries(db, other, '2026-09-01', '2026-09-30');
    expect(otherDays).toHaveLength(0);
  });

  it('normalizeRange rejects oversized spans', () => {
    const r = reads.normalizeRange('2026-01-01', '2026-06-01', { maxDays: 90 });
    expect(r.error).toMatch(/too long/);
  });

  it('search_recipes finds by name', () => {
    const recipes = reads.searchRecipes(db, userId, 'bowl');
    expect(recipes[0].name).toBe('Test Bowl');
  });
});

describe('MCP get_intake_weight_trend', () => {
  let db;
  let userId;
  let recipeId;

  function insertMeal(date, calories) {
    db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, servings, recipe_name, serving_size,
         recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g, recipe_is_quick_food
       ) VALUES (?, ?, ?, 1, 'Meal', '1', ?, 40, 50, 15, 8, 0)`
    ).run(userId, recipeId, date, calories);
  }

  function insertWeight(date, kg) {
    db.prepare(
      'INSERT INTO body_weights (user_id, date, weight_kg) VALUES (?, ?, ?)'
    ).run(userId, date, kg);
  }

  beforeEach(() => {
    const built = buildTestApp();
    db = built.db;
    userId = createUser(db, 'trend@mcp.test').id;
    db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, is_quick_food)
       VALUES (?, 'Meal', '1', 2500, 40, 50, 15, 8, '[]', 0)`
    ).run(userId);
    recipeId = db.prepare('SELECT id FROM recipes WHERE user_id = ?').get(userId).id;
  });

  it('rejects ranges over 90 days like get_log_range', () => {
    const r = reads.getIntakeWeightTrend(db, userId, {
      start: '2026-01-01',
      end: '2026-06-01',
    });
    expect(r.error).toMatch(/too long/);
  });

  it('averages intake over logged days only and reports coverage', () => {
    // 10-day window, food on only 2 days
    insertMeal('2026-09-01', 2000);
    insertMeal('2026-09-05', 3000);
    insertWeight('2026-09-01', 68);
    insertWeight('2026-09-03', 68.1);
    insertWeight('2026-09-05', 68.2);
    insertWeight('2026-09-07', 68.3);
    insertWeight('2026-09-09', 68.4);

    const r = reads.getIntakeWeightTrend(db, userId, {
      start: '2026-09-01',
      end: '2026-09-10',
    });
    expect(r.error).toBeUndefined();
    expect(r.window.days_in_range).toBe(10);
    expect(r.window.days_with_food_log).toBe(2);
    expect(r.window.avg_daily_calories).toBe(2500);
    expect(r.window.weigh_in_count).toBe(5);
  });

  it('flags <5 weigh-ins as low confidence', () => {
    insertMeal('2026-09-01', 2500);
    insertWeight('2026-09-01', 68);
    insertWeight('2026-09-05', 68.2);
    insertWeight('2026-09-09', 68.4);

    const r = reads.getIntakeWeightTrend(db, userId, {
      start: '2026-09-01',
      end: '2026-09-10',
    });
    expect(r.window.weigh_in_count).toBe(3);
    expect(r.window.confidence).toBe('low');
    expect(r.window.confidence_reason).toMatch(/3 weigh-ins/);
  });

  it('split_at returns baseline, current, and delta', () => {
    // Baseline week: ~2600 cal, flat weight ~67.7 kg (~149.3 lb)
    for (const [d, cal] of [
      ['2026-08-20', 2600],
      ['2026-08-22', 2550],
      ['2026-08-25', 2650],
      ['2026-08-28', 2580],
      ['2026-09-01', 2620],
      ['2026-09-05', 2590],
      ['2026-09-10', 2610],
    ]) {
      insertMeal(d, cal);
    }
    for (const [d, kg] of [
      ['2026-08-20', 67.72],
      ['2026-08-23', 67.7],
      ['2026-08-26', 67.75],
      ['2026-08-29', 67.68],
      ['2026-09-02', 67.72],
      ['2026-09-06', 67.7],
      ['2026-09-10', 67.73],
    ]) {
      insertWeight(d, kg);
    }

    // Current segment from 2026-09-11: higher intake, rising weight
    for (const [d, cal] of [
      ['2026-09-11', 3000],
      ['2026-09-13', 3050],
      ['2026-09-15', 3020],
      ['2026-09-17', 3080],
      ['2026-09-19', 3000],
    ]) {
      insertMeal(d, cal);
    }
    for (const [d, kg] of [
      ['2026-09-11', 67.9],
      ['2026-09-13', 68.0],
      ['2026-09-15', 68.1],
      ['2026-09-17', 68.25],
      ['2026-09-19', 68.35],
    ]) {
      insertWeight(d, kg);
    }

    const r = reads.getIntakeWeightTrend(db, userId, {
      start: '2026-08-20',
      end: '2026-09-19',
      split_at: '2026-09-11',
    });
    expect(r.error).toBeUndefined();
    expect(r.split_at).toBe('2026-09-11');
    expect(r.baseline.avg_daily_calories).toBeGreaterThan(2500);
    expect(r.baseline.avg_daily_calories).toBeLessThan(2700);
    expect(r.current.avg_daily_calories).toBeGreaterThan(2900);
    expect(r.delta.avg_daily_calories).toBeGreaterThan(300);
    expect(r.current.slope_lb_per_week).toBeGreaterThan(0);
    expect(r.baseline.estimated_maintenance_kcal).toBeGreaterThan(2500);
    expect(r.baseline.estimated_maintenance_kcal).toBeLessThan(2800);
    expect(r.baseline.estimated_maintenance_note).toMatch(/Inference/);
  });
});

