const request = require('supertest');
const { buildTestApp, createUser, authHeader } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

/**
 * grams_per_ml bridges weight and volume: a liquid saved per ml can be logged
 * by the gram, and a weighed food by the cup, without a second library row.
 */
describe('ingredient density (grams_per_ml)', () => {
  let app;
  let db;
  let userId;
  let soyId;
  let yogurtId;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'density@mcp.test').id;
    // Soy sauce saved the way the library has it: 15 ml, no gram weight.
    soyId = db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type, unit_name, serving_quantity
       ) VALUES (?, 'Soy sauce', '15 ml', 10, 1, 2, 0, 'manual', 'unit', 'ml', 15)`
    ).run(userId).lastInsertRowid;
    yogurtId = db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type
       ) VALUES (?, 'Greek yogurt', '170 g', 170, 110, 17, 7, 0, 'manual', 'weight')`
    ).run(userId).lastInsertRowid;
  });

  const logOne = item => writes.logMeal(db, userId, {
    date: '2026-10-07',
    weight_basis: 'raw',
    items: [{ nutrition_source: 'database', ...item }],
  });

  it('refuses grams on a per-ml liquid until it has a density', () => {
    const r = logOne({ label_ingredient_id: soyId, quantity_g: 50 });
    expect(r.code).toBe('UNIT_NOT_CONVERTIBLE');
  });

  it('logs 50 g of soy sauce once grams_per_ml is set', () => {
    const u = writes.updateFoodItem(db, userId, { label_ingredient_id: soyId, grams_per_ml: 1.2 });
    expect(u.error).toBeUndefined();
    expect(u.after.grams_per_ml).toBe(1.2);

    const r = logOne({ label_ingredient_id: soyId, quantity_g: 50 });
    expect(r.error).toBeUndefined();
    // 50 g / 1.2 g per ml = 41.67 ml = 2.78 servings of 15 ml.
    expect(r.entry.ingredients[0].protein_g).toBeCloseTo((50 / 1.2 / 15) * 1, 1);
    expect(r.entry.ingredients[0].calories).toBeCloseTo((50 / 1.2 / 15) * 10, 0);
  });

  it('logs a weighed food by the cup once it has a density', () => {
    expect(logOne({ label_ingredient_id: yogurtId, quantity: 1, unit: 'cup' }).code).toBe('UNIT_NOT_CONVERTIBLE');
    writes.updateFoodItem(db, userId, { label_ingredient_id: yogurtId, grams_per_ml: 1.05 });
    const r = logOne({ label_ingredient_id: yogurtId, quantity: 1, unit: 'cup' });
    expect(r.error).toBeUndefined();
    const grams = 236.5882365 * 1.05;
    expect(r.entry.ingredients[0].protein_g).toBeCloseTo((grams / 170) * 17, 1);
  });

  it('search shows the density and every loggable unit', () => {
    writes.updateFoodItem(db, userId, { label_ingredient_id: soyId, grams_per_ml: 1.2 });
    const [soy] = reads.searchIngredients(db, userId, 'soy');
    expect(soy.grams_per_ml).toBe(1.2);
    expect(soy.loggable_units).toEqual(['ml', 'fl oz', 'cup', 'tbsp', 'tsp', 'g', 'oz']);
    expect(soy.per_100g.protein_g).toBeCloseTo((100 / 1.2 / 15) * 1, 1);
    expect(soy.log_by).toMatch(/or quantity_g/);
    const [yogurt] = reads.searchIngredients(db, userId, 'yogurt');
    expect(yogurt.loggable_units).toEqual(['g', 'oz']);
  });

  it('rejects a density in the wrong unit and reverts cleanly', () => {
    expect(writes.updateFoodItem(db, userId, { label_ingredient_id: soyId, grams_per_ml: 120 }).error)
      .toMatch(/grams_per_ml/);
    const u = writes.updateFoodItem(db, userId, { label_ingredient_id: soyId, grams_per_ml: 1.2 });
    expect(writes.revertMcpWrite(db, userId, { audit_id: u.audit_id }).error).toBeUndefined();
    const row = db.prepare('SELECT grams_per_ml FROM label_ingredients WHERE id = ?').get(soyId);
    expect(row.grams_per_ml).toBeNull();
  });

  it('add_food_item stores a density', () => {
    const r = writes.addFoodItem(db, userId, {
      name: 'Clover honey',
      calories_per_100g: 304, protein_g_per_100g: 0.3, carbs_g_per_100g: 82, fat_g_per_100g: 0,
      nutrition_source: 'database', weight_basis: 'raw', grams_per_serving: 21, grams_per_ml: 1.42,
    });
    expect(r.error).toBeUndefined();
    const honey = logOne({ label_ingredient_id: r.label_ingredient_id, quantity: 1, unit: 'tbsp' });
    expect(honey.error).toBeUndefined();
    expect(honey.entry.ingredients[0].carbs_g).toBeCloseTo(14.78676478125 * 1.42 * 0.82, 1);
  });

  it('the app edit form keeps a stored density it does not send', async () => {
    writes.updateFoodItem(db, userId, { label_ingredient_id: soyId, grams_per_ml: 1.2 });
    const res = await request(app)
      .put(`/api/label-ingredients/${soyId}`)
      .set(authHeader(db, userId))
      .send({
        name: 'Soy sauce (low sodium)', serving_size_text: '15 ml', calories: 10, protein_g: 1, carbs_g: 2, fat_g: 0,
        tracking_type: 'unit', unit_name: 'ml', serving_quantity: 15,
      });
    expect(res.status).toBe(200);
    expect(res.body.grams_per_ml).toBe(1.2);
  });
});

describe('update_food_item response over MCP', () => {
  let app;
  let db;
  let soyId;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    const userId = createUser(db, 'owner@mcp.test').id;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
    soyId = db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type, unit_name, serving_quantity, micros_json
       ) VALUES (?, 'Soy sauce', '15 ml', 10, 1, 2, 0, 'manual', 'unit', 'ml', 15, ?)`
    ).run(userId, JSON.stringify({ micros: { sodium_mg: 880, potassium_mg: 65 }, confidence: 'medium' })).lastInsertRowid;
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
    return { text: res.body.result.content[0].text, body: JSON.parse(res.body.result.content[0].text) };
  };

  it('returns only the changed fields, not two copies of the row', async () => {
    const { text, body } = await call('update_food_item', { label_ingredient_id: soyId, grams_per_ml: 1.2 });
    expect(body.changed).toEqual({ grams_per_ml: { before: null, after: 1.2 } });
    expect(body).toMatchObject({ label_ingredient_id: soyId, name: 'Soy sauce' });
    expect(body.before).toBeUndefined();
    expect(body.after).toBeUndefined();
    expect(text).not.toMatch(/micros_json/);
    expect(body.micros_changed).toBeUndefined();
  });

  it('diffs micros per nutrient when they change', async () => {
    const { body } = await call('update_food_item', {
      label_ingredient_id: soyId, micros: { sodium_mg: 900, potassium_mg: 65 }, micros_confidence: 'high',
    });
    expect(body.micros_changed).toEqual({ sodium_mg: { before: 880, after: 900 } });
  });

  it('trims update steps inside write_batch and still reverts the full row', async () => {
    const { text, body } = await call('write_batch', {
      operations: [{ op: 'update_food_item', label_ingredient_id: soyId, grams_per_ml: 1.2, micros: { sodium_mg: 900 }, micros_confidence: 'high' }],
    });
    expect(text).not.toMatch(/micros_json/);
    expect(body.results[0].changed.grams_per_ml).toEqual({ before: null, after: 1.2 });

    const { body: reverted } = await call('revert_mcp_write', { audit_id: body.audit_id });
    expect(reverted.error).toBeUndefined();
    const row = db.prepare('SELECT grams_per_ml, micros_json FROM label_ingredients WHERE id = ?').get(soyId);
    expect(row.grams_per_ml).toBeNull();
    expect(JSON.parse(row.micros_json).micros).toEqual({ sodium_mg: 880, potassium_mg: 65 });
  });
});
