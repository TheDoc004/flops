const request = require('supertest');
const { buildTestApp, createUser, authHeader } = require('./helpers');
const { repairMcpRecipeEntrySnapshots } = require('../db');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

/**
 * A meal prep created + logged through MCP must carry the same per-serving
 * ingredients snapshot (and therefore live micros) as one logged in the app.
 */
describe('MCP meal prep → log → micros', () => {
  let app;
  let db;
  let userId;
  let potatoId;

  beforeEach(() => {
    ({ app, db } = buildTestApp());
    userId = createUser(db, 'prep@mcp.test').id;
    const food = writes.addFoodItem(db, userId, {
      name: 'Russet potato',
      grams_per_serving: 100,
      calories_per_100g: 78,
      protein_g_per_100g: 2.1,
      carbs_g_per_100g: 17.8,
      fat_g_per_100g: 0.1,
      nutrition_source: 'database',
      weight_basis: 'raw',
      micros_per_100g: { vitamin_c_mg: 20, potassium_mg: 400 },
      micros_confidence: 'medium',
    });
    potatoId = food.label_ingredient_id ?? food.result_row_ids.label_ingredient_ids[0];
  });

  function createPrep() {
    return writes.createMealPrep(db, userId, {
      name: 'Potato Stew',
      servings: 4,
      weight_basis: 'raw',
      items: [
        { label_ingredient_id: potatoId, quantity_g: 800, nutrition_source: 'label' },
        {
          name: 'Stew spice mix',
          quantity_g: 40,
          calories_per_100g: 300,
          protein_g_per_100g: 10,
          carbs_g_per_100g: 60,
          fat_g_per_100g: 5,
          nutrition_source: 'estimate',
        },
      ],
    });
  }

  function logContainer(recipeId) {
    return writes.logMeal(db, userId, {
      date: '2026-10-02',
      weight_basis: 'raw',
      items: [{ recipe_id: recipeId, servings: 1, nutrition_source: 'label' }],
    });
  }

  it('logged container has a snapshot and per-serving micros (spice mix contributes none)', () => {
    const prep = createPrep();
    expect(prep.error).toBeUndefined();
    const logged = logContainer(prep.recipe.id);
    expect(logged.error).toBeUndefined();

    const entry = logged.entry;
    // 200 g potato per container → 2 × the per-100g micros; spice mix has none.
    expect(entry.micros).toMatchObject({ vitamin_c_mg: 40, potassium_mg: 800 });
    expect(entry.micros_source).toBe('ingredients');
    expect(entry.micros_confidence).toBe('medium');
    expect(entry.ingredients).toHaveLength(2);
    expect(entry.ingredients[0]).toMatchObject({
      label_ingredient_id: potatoId, amount: 200, unit: 'g', source: 'library',
    });
    // Macros still come from the recipe row, unchanged.
    expect(entry.per_serving.calories).toBe(prep.per_serving.calories);
    expect(entry.nutrition_source).toBe('label');
  });

  it('matches what POST /api/log stores for the same recipe', async () => {
    const prep = createPrep();
    const mcpEntry = logContainer(prep.recipe.id).entry;

    const res = await request(app)
      .post('/api/log')
      .set(authHeader(db, userId))
      .send({ recipe_id: prep.recipe.id, date: '2026-10-03', servings: 1 });
    expect(res.status).toBe(201);
    const appEntry = reads.getDay(db, userId, '2026-10-03').meals[0];

    expect(mcpEntry.ingredients).toEqual(appEntry.ingredients);
    expect(mcpEntry.micros).toEqual(appEntry.micros);
    expect(mcpEntry.micros_source).toBe(appEntry.micros_source);
  });

  it('backfill fills snapshots on old MCP recipe logs and is idempotent', () => {
    const prep = createPrep();
    const logged = logContainer(prep.recipe.id);
    // Recreate the pre-fix row: no snapshot.
    db.prepare('UPDATE log_entries SET ingredients_json = NULL WHERE id = ?').run(logged.entry.id);
    expect(reads.getDay(db, userId, '2026-10-02').meals[0].micros).toBeNull();

    expect(repairMcpRecipeEntrySnapshots(db)).toBe(1);
    const fixed = reads.getDay(db, userId, '2026-10-02').meals[0];
    expect(fixed.micros).toMatchObject({ vitamin_c_mg: 40, potassium_mg: 800 });
    expect(fixed.ingredients).toHaveLength(2);
    expect(fixed.per_serving.calories).toBe(prep.per_serving.calories);
    expect(repairMcpRecipeEntrySnapshots(db)).toBe(0);
  });
});
