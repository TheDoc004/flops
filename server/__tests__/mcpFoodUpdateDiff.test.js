const request = require('supertest');
const { buildTestApp, createUser } = require('./helpers');

/**
 * update_food_item's `changed` diff is how a caller confirms a write landed.
 * servings_per_container once looked like a no-op (`changed: {}`) — these pin
 * down every null <-> value transition, the explicit no_change flag, and that
 * revert puts the old value back.
 */
describe('update_food_item changed diff over MCP', () => {
  let app;
  let db;
  let beansId;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    const userId = createUser(db, 'owner@mcp.test').id;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
    beansId = db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type, nutrition_source, micros_json
       ) VALUES (?, 'Black beans', '1/2 cup (130g)', 130, 110, 7, 20, 0, 'manual', 'weight', 'label', ?)`
    ).run(userId, JSON.stringify({ micros: { sodium_mg: 400 }, confidence: 'high' })).lastInsertRowid;
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
    return JSON.parse(res.body.result.content[0].text);
  };
  const update = args => call('update_food_item', { label_ingredient_id: beansId, ...args });
  const stored = () =>
    db.prepare('SELECT servings_per_container FROM label_ingredients WHERE id = ?').get(beansId).servings_per_container;

  it('reports servings_per_container null -> value', async () => {
    const body = await update({ servings_per_container: 3.5 });
    expect(body.changed).toEqual({ servings_per_container: { before: null, after: 3.5 } });
    expect(body.no_change).toBeUndefined();
  });

  it('reports servings_per_container value -> value and value -> null', async () => {
    await update({ servings_per_container: 3.5 });
    expect((await update({ servings_per_container: 4 })).changed)
      .toEqual({ servings_per_container: { before: 3.5, after: 4 } });
    expect((await update({ servings_per_container: null })).changed)
      .toEqual({ servings_per_container: { before: 4, after: null } });
  });

  it('flags a repeat of the stored value as no_change', async () => {
    await update({ servings_per_container: 3.5 });
    const body = await update({ servings_per_container: 3.5 });
    expect(body.changed).toEqual({});
    expect(body.no_change).toBe(true);
    expect(body.micros_changed).toBeUndefined();
  });

  it('diffs every other writable field in both null directions', async () => {
    const set = await update({
      name: 'Beans', brand_name: 'Kroger', serving_size_text: '1/2 cup', fiber_g: 5,
      weight_basis: 'cooked', grams_per_ml: 1.1,
    });
    expect(set.changed).toEqual({
      name: { before: 'Black beans', after: 'Beans' },
      brand_name: { before: null, after: 'Kroger' },
      serving_size_text: { before: '1/2 cup (130g)', after: '1/2 cup' },
      fiber_g: { before: null, after: 5 },
      weight_basis: { before: null, after: 'cooked' },
      grams_per_ml: { before: null, after: 1.1 },
    });
    const cleared = await update({ brand_name: null, fiber_g: null, grams_per_ml: null });
    expect(cleared.changed).toEqual({
      brand_name: { before: 'Kroger', after: null },
      fiber_g: { before: 5, after: null },
      grams_per_ml: { before: 1.1, after: null },
    });
  });

  it('keeps the macro / grams_per_serving / nutrition_source diff as before', async () => {
    const body = await update({ grams_per_serving: 120, calories: 100, protein_g: 6, nutrition_source: 'database' });
    expect(body.changed).toEqual({
      grams_per_serving: { before: 130, after: 120 },
      calories: { before: 110, after: 100 },
      protein_g: { before: 7, after: 6 },
      nutrition_source: { before: 'label', after: 'database' },
    });
    expect(body.no_change).toBeUndefined();
  });

  it('is not no_change when only micros changed', async () => {
    const body = await update({ micros: { sodium_mg: 410 }, micros_confidence: 'high' });
    expect(body.changed).toEqual({});
    expect(body.micros_changed).toEqual({ sodium_mg: { before: 400, after: 410 } });
    expect(body.no_change).toBeUndefined();
  });

  it('flags no_change on a write_batch step too', async () => {
    await update({ servings_per_container: 3.5 });
    const body = await call('write_batch', {
      operations: [{ op: 'update_food_item', label_ingredient_id: beansId, servings_per_container: 3.5 }],
    });
    expect(body.results[0].no_change).toBe(true);
  });

  it('revert restores servings_per_container back to null', async () => {
    const body = await update({ servings_per_container: 3.5 });
    expect(stored()).toBe(3.5);
    const reverted = await call('revert_mcp_write', { audit_id: body.audit_id });
    expect(reverted.ok).toBe(true);
    expect(stored()).toBeNull();
  });

  it('revert restores servings_per_container back to the prior value', async () => {
    await update({ servings_per_container: 3.5 });
    const body = await update({ servings_per_container: 4 });
    await call('revert_mcp_write', { audit_id: body.audit_id });
    expect(stored()).toBe(3.5);
  });

  it('revert of a batch step restores servings_per_container', async () => {
    const body = await call('write_batch', {
      operations: [{ op: 'update_food_item', label_ingredient_id: beansId, servings_per_container: 2 }],
    });
    expect(body.results[0].changed).toEqual({ servings_per_container: { before: null, after: 2 } });
    await call('revert_mcp_write', { audit_id: body.audit_id });
    expect(stored()).toBeNull();
  });
});
