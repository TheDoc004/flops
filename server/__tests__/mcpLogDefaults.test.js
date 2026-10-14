const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');

/**
 * Logging a saved recipe or meal prep shouldn't need fields that only mean
 * something for single foods: the recipe's lines already carry their own
 * nutrition sources and were built from raw amounts.
 */
describe('log_meal defaults for recipe items', () => {
  let db;
  let userId;
  let recipeId;
  let prepId;
  let foodId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'defaults@mcp.test').id;
    foodId = db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving,
         calories, protein_g, carbs_g, fat_g)
       VALUES (?, 'Honey', '100 g', 100, 300, 0, 80, 0)`
    ).run(userId).lastInsertRowid;
    recipeId = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, recipe_kind)
       VALUES (?, 'Bowl', '1 meal', 400, 30, 50, 10, 0, '[]', 'permanent')`
    ).run(userId).lastInsertRowid;
    prepId = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients,
         recipe_kind, remaining_uses, max_uses)
       VALUES (?, 'Pasta prep', '1 of 5', 800, 60, 80, 20, 0, '[]', 'limited', 2, 5)`
    ).run(userId).lastInsertRowid;
  });

  test('a recipe-only meal needs neither weight_basis nor nutrition_source', () => {
    const r = writes.logMeal(db, userId, {
      date: '2026-10-13',
      items: [{ recipe_id: recipeId, servings: 1 }],
    });
    expect(r.error).toBeUndefined();
    expect(r.entry.weight_basis).toBe('raw');
    expect(r.entry.nutrition_source).toBe('database');
    expect(r.entry.logged.calories).toBe(400);
  });

  test('a meal prep logs with defaults and still counts down a use', () => {
    const r = writes.logMeal(db, userId, {
      date: '2026-10-13',
      meal_slot: 'lunch',
      items: [{ recipe_id: prepId, servings: 1 }],
    });
    expect(r.error).toBeUndefined();
    expect(db.prepare('SELECT remaining_uses FROM recipes WHERE id = ?').get(prepId).remaining_uses).toBe(1);
  });

  test('an explicit nutrition_source on a recipe item is still honored and validated', () => {
    const bad = writes.logMeal(db, userId, {
      date: '2026-10-13',
      items: [{ recipe_id: recipeId, servings: 1, nutrition_source: 'guess' }],
    });
    expect(bad.error).toMatch(/nutrition_source must be/);
  });

  test('a meal with a single food still requires weight_basis and nutrition_source', () => {
    const noBasis = writes.logMeal(db, userId, {
      date: '2026-10-13',
      items: [{ recipe_id: prepId, servings: 1 }, { label_ingredient_id: foodId, quantity_g: 21, nutrition_source: 'label' }],
    });
    expect(noBasis.error).toMatch(/weight_basis is required/);

    const noSource = writes.logMeal(db, userId, {
      date: '2026-10-13',
      weight_basis: 'raw',
      items: [{ label_ingredient_id: foodId, quantity_g: 21 }],
    });
    expect(noSource.error).toMatch(/nutrition_source must be/);
  });

  test('an unknown "slot" param points at meal_slot', () => {
    const r = writes.logMeal(db, userId, {
      date: '2026-10-13',
      slot: 'snack',
      items: [{ recipe_id: recipeId, servings: 1 }],
    });
    expect(r.code).toBe('UNKNOWN_PARAM');
    expect(r.error).toMatch(/did you mean "meal_slot"/);
  });
});
