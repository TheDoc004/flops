const request = require('supertest');
const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

/**
 * A saved recipe logged with today's amounts: "Wombo Combo, but 180 g yogurt,
 * 73 g bread, no honey, plus sriracha" — one entry, linked to the recipe,
 * macros recomputed from the library at the logged amounts.
 */
describe('log_meal recipe adjust + get_recipe', () => {
  let app;
  let db;
  let userId;
  let ids;
  let wombo;
  const prevToken = process.env.MCP_API_TOKEN;
  const prevUser = process.env.MCP_USER_ID;

  const food = (name, gps, cal, p, c, f) =>
    db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving,
         calories, protein_g, carbs_g, fat_g, micros_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, name, `${gps} g`, gps, cal, p, c, f,
      JSON.stringify({ micros: { potassium_mg: 100 }, confidence: 'medium' })).lastInsertRowid;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'owner@mcp.test').id;
    process.env.MCP_API_TOKEN = 'test-mcp-secret-token';
    delete process.env.MCP_USER_ID;
    ids = {
      yogurt: food('Greek yogurt', 100, 60, 10, 4, 0),
      bread: food('Sourdough', 100, 200, 8, 40, 0),
      honey: food('Honey', 100, 300, 0, 80, 0),
      sriracha: food('Sriracha', 100, 100, 0, 20, 0),
    };
    const line = (id, name, amount) => ({ kind: 'ingredient', name, amount: String(amount), unit: 'g', label_ingredient_id: id });
    wombo = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind)
       VALUES (?, 'Wombo Combo', '1 meal', 488, 28, 112, 0, 0, ?, 'permanent')`
    ).run(userId, JSON.stringify([
      line(ids.yogurt, 'Greek yogurt', 170),
      line(ids.bread, 'Sourdough', 112),
      line(ids.honey, 'Honey', 21),
    ])).lastInsertRowid;
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
    return { isError: !!res.body.result.isError, body: JSON.parse(res.body.result.content[0].text) };
  };

  it('get_recipe lists the lines with their label ids and per-serving macros', async () => {
    const { body } = await call('get_recipe', { recipe_id: wombo });
    expect(body.name).toBe('Wombo Combo');
    expect(body.lines.map(l => [l.label_ingredient_id, l.amount, l.unit])).toEqual([
      [ids.yogurt, 170, 'g'], [ids.bread, 112, 'g'], [ids.honey, 21, 'g'],
    ]);
    expect(body.lines[1]).toMatchObject({ calories: 224, protein_g: 8.96 });
  });

  it('get_recipe reports a broken line on its own instead of hiding every line', async () => {
    const slices = db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
         tracking_type, unit_name, serving_quantity)
       VALUES (?, 'Old sourdough', '1 slice', 120, 4, 24, 1, 'unit', 'slice', 1)`
    ).run(userId).lastInsertRowid;
    const lines = JSON.parse(db.prepare('SELECT ingredients FROM recipes WHERE id = ?').get(wombo).ingredients);
    lines.push({ kind: 'ingredient', name: 'Old sourdough', amount: '100', unit: 'g', label_ingredient_id: slices });
    db.prepare('UPDATE recipes SET ingredients = ? WHERE id = ?').run(JSON.stringify(lines), wombo);

    const { body } = await call('get_recipe', { recipe_id: wombo });
    expect(body.lines).toHaveLength(4);
    expect(body.lines.slice(0, 3).every(l => !l.error && l.calories > 0)).toBe(true);
    expect(body.lines[3]).toMatchObject({ label_ingredient_id: slices, amount: 100, unit: 'g' });
    expect(body.lines[3].error).toMatch(/NOT_CONVERTIBLE/);
    expect(body.lines[3].hint).toMatch(/can be measured in: slice/);
    expect(body.broken_lines).toBe(1);
  });

  it('logs the recipe with changed amounts, a removed line, and an add-on — as one linked entry', async () => {
    const { isError, body } = await call('log_meal', {
      date: '2026-10-09',
      weight_basis: 'raw',
      items: [
        {
          recipe_id: wombo, servings: 1, nutrition_source: 'database',
          adjust: [
            { label_ingredient_id: ids.yogurt, quantity_g: 180 },
            { label_ingredient_id: ids.bread, quantity_g: 73 },
            { label_ingredient_id: ids.honey, remove: true },
          ],
        },
        { label_ingredient_id: ids.sriracha, quantity_g: 5, nutrition_source: 'database' },
      ],
    });
    expect(isError).toBe(false);
    const e = body.entry;
    expect(e.recipe_id).toBe(wombo);
    expect(e.recipe_name).toBe('Wombo Combo + Sriracha');
    // yogurt 180 g = 108 kcal / 18 P; bread 73 g = 146 kcal / 5.84 P; sriracha 5 g = 5 kcal
    expect(e.logged).toEqual({ calories: 259, protein_g: 23.84, carbs_g: 37.4, fat_g: 0 });
    expect(e.ingredients.map(r => [r.name, r.amount])).toEqual([
      ['Greek yogurt', 180], ['Sourdough', 73], ['Sriracha', 5],
    ]);
    expect(e.micros.potassium_mg).toBeCloseTo(100 * (1.8 + 0.73 + 0.05), 1);
  });

  it('an adjusted recipe alone keeps the recipe name and scales by servings', () => {
    const r = writes.logMeal(db, userId, {
      date: '2026-10-09', weight_basis: 'raw',
      items: [{
        recipe_id: wombo, servings: 2, nutrition_source: 'database',
        adjust: [{ label_ingredient_id: ids.bread, quantity_g: 73 }],
      }],
    });
    expect(r.error).toBeUndefined();
    expect(r.entry.recipe_name).toBe('Wombo Combo');
    expect(r.entry.servings).toBe(2);
    // per serving: yogurt 170 (102) + bread 73 (146) + honey 21 (63) = 311 kcal
    expect(r.entry.logged.calories).toBe(622);
    expect(reads.getDay(db, userId, '2026-10-09').meal_totals.calories).toBe(622);
  });

  it('refuses a line that is not in the recipe, and adjust on a non-recipe item', () => {
    const notIn = writes.logMeal(db, userId, {
      date: '2026-10-09', weight_basis: 'raw',
      items: [{
        recipe_id: wombo, servings: 1, nutrition_source: 'database',
        adjust: [{ label_ingredient_id: ids.sriracha, quantity_g: 5 }],
      }],
    });
    expect(notIn.code).toBe('NOT_IN_RECIPE');
    const onFood = writes.logMeal(db, userId, {
      date: '2026-10-09', weight_basis: 'raw',
      items: [{ label_ingredient_id: ids.yogurt, quantity_g: 100, nutrition_source: 'database', adjust: [{ label_ingredient_id: ids.yogurt, quantity_g: 1 }] }],
    });
    expect(onFood.error).toMatch(/only applies to recipe items/);
    expect(reads.getDay(db, userId, '2026-10-09').meals).toHaveLength(0);
  });

  it('update_meal_entry no longer repeats every ingredient in items_resolved', async () => {
    const logged = await call('log_meal', {
      date: '2026-10-09', weight_basis: 'raw',
      items: [{ recipe_id: wombo, servings: 1, nutrition_source: 'database' }],
    });
    const { body } = await call('update_meal_entry', {
      log_entry_id: logged.body.entry.id, weight_basis: 'raw',
      items: [{
        recipe_id: wombo, servings: 1, nutrition_source: 'database',
        adjust: [{ label_ingredient_id: ids.honey, quantity_g: 16 }],
      }],
    });
    expect(body.items_resolved).toBeUndefined();
    expect(body.after.recipe_id).toBe(wombo);
    expect(body.after.ingredients.find(r => r.name === 'Honey').amount).toBe(16);
  });

  it('update_recipe replaces the lines, recomputes macros, and reverts', async () => {
    const eggs = db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
         tracking_type, unit_name, serving_quantity, grams_per_unit)
       VALUES (?, 'eggs', '1 egg', 70, 6, 0.5, 5, 'unit', 'egg', 1, 50)`
    ).run(userId).lastInsertRowid;
    const { isError, body } = await call('update_recipe', {
      recipe_id: wombo,
      lines: [
        { label_ingredient_id: eggs, quantity: 4, unit: 'egg' },
        { label_ingredient_id: ids.yogurt, quantity_g: 180 },
        { label_ingredient_id: ids.bread, quantity_g: 112 },
      ],
    });
    expect(isError).toBe(false);
    expect(body.per_serving_before.calories).toBe(488);
    // 4 eggs 280 + yogurt 180 g 108 + bread 112 g 224
    expect(body.per_serving).toMatchObject({ calories: 612, protein_g: 50.96 });
    expect(body.before).toBeUndefined();
    expect(body.lines.map(l => [l.name, l.amount, l.unit])).toEqual([
      ['eggs', 4, 'egg'], ['Greek yogurt', 180, 'g'], ['Sourdough', 112, 'g'],
    ]);

    const recipe = (await call('get_recipe', { recipe_id: wombo })).body;
    expect(recipe.broken_lines).toBeUndefined();
    expect(recipe.per_serving.calories).toBe(612);

    // adjust now works against the new lines
    const logged = writes.logMeal(db, userId, {
      date: '2026-10-11', weight_basis: 'raw',
      items: [{ recipe_id: wombo, servings: 1, nutrition_source: 'database',
        adjust: [{ label_ingredient_id: ids.bread, quantity_g: 56 }] }],
    });
    expect(logged.entry.logged.calories).toBe(500);

    const rev = await call('revert_mcp_write', { audit_id: body.audit_id });
    expect(rev.isError).toBe(false);
    expect(db.prepare('SELECT calories FROM recipes WHERE id = ?').get(wombo).calories).toBe(488);
  });

  it('update_recipe refuses meal preps and unconvertible lines', () => {
    const prep = writes.createMealPrep(db, userId, {
      name: 'Prep', servings: 2, weight_basis: 'raw',
      items: [{ label_ingredient_id: ids.yogurt, quantity_g: 400, nutrition_source: 'database' }],
    }).recipe.id;
    expect(writes.updateRecipe(db, userId, { recipe_id: prep, lines: [{ label_ingredient_id: ids.yogurt, quantity_g: 100 }] }).code)
      .toBe('MEAL_PREP');
    expect(writes.updateRecipe(db, userId, { recipe_id: wombo, lines: [{ label_ingredient_id: ids.yogurt, quantity: 1, unit: 'cup' }] }).code)
      .toBe('UNIT_NOT_CONVERTIBLE');
    expect(db.prepare('SELECT calories FROM recipes WHERE id = ?').get(wombo).calories).toBe(488);
  });
});
