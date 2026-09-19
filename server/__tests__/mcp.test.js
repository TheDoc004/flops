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
        'get_day',
        'get_log_range',
        'get_goals',
        'get_body_weights',
        'get_profile',
        'get_supplements_range',
        'get_micronutrient_totals',
        'search_recipes',
        'get_gym_today',
        'get_gym_progress',
      ])
    );
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
