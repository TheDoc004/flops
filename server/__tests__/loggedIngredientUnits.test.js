const { createDb, repairLoggedIngredientUnits } = require('../db');
const { displayUnitForIngredient } = require('../recipeIngredients');

describe('displayUnitForIngredient', () => {
  it('uses the ingredient\'s own unit name when it is counted', () => {
    expect(displayUnitForIngredient({ tracking_type: 'unit', unit_name: 'egg' }, 'g')).toBe('egg');
    expect(displayUnitForIngredient({ tracking_type: 'unit', unit_name: 'spray' }, 'g')).toBe('spray');
  });

  it('falls back to "unit" when a counted ingredient has no unit name', () => {
    expect(displayUnitForIngredient({ tracking_type: 'unit', unit_name: '' }, 'g')).toBe('unit');
    expect(displayUnitForIngredient({ tracking_type: 'unit' }, 'g')).toBe('unit');
  });

  it('keeps grams and ounces for weighed ingredients', () => {
    expect(displayUnitForIngredient({ tracking_type: 'weight' }, 'g')).toBe('g');
    expect(displayUnitForIngredient({ tracking_type: 'weight' }, 'oz')).toBe('oz');
    expect(displayUnitForIngredient(null, 'g')).toBe('g');
  });
});

/**
 * The boot-time repair of historical rows. Everything here goes through
 * createDb() so the migration under test is the one that actually runs.
 */
describe('logged ingredient unit backfill', () => {
  function seed(rows, ingredient) {
    const db = createDb(':memory:');
    db.prepare(
      `INSERT INTO label_ingredients (id, user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g, tracking_type, unit_name, serving_quantity, grams_per_serving)
       VALUES (@id, 0, @name, '1 serving', @calories, 0, 0, 0, @tracking_type, @unit_name, @serving_quantity, @grams_per_serving)`
    ).run({
      grams_per_serving: null,
      unit_name: null,
      serving_quantity: null,
      ...ingredient,
    });
    const r = db
      .prepare(`INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, ingredients) VALUES ('m', '1', 0, 0, 0, 0, '[]')`)
      .run();
    db.prepare(
      `INSERT INTO log_entries (recipe_id, date, servings, ingredients_json) VALUES (?, '2026-07-26', 1, ?)`
    ).run(r.lastInsertRowid, JSON.stringify(rows));
    // createDb already migrated an empty database — run the repair now that
    // there is something to repair.
    repairLoggedIngredientUnits(db);
    return db;
  }

  const readRows = db =>
    JSON.parse(db.prepare('SELECT ingredients_json FROM log_entries LIMIT 1').get().ingredients_json);

  it('relabels a counted ingredient that was stored as grams', () => {
    // 3 eggs at 70 cal each = 210 — consistent with the count reading.
    const db = seed(
      [{ name: 'eggs', amount: 3, unit: 'g', calories: 210, label_ingredient_id: 4 }],
      { id: 4, name: 'eggs', calories: 70, tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1 }
    );
    expect(readRows(db)[0].unit).toBe('egg');
  });

  it('respects a serving quantity greater than one', () => {
    // Ingredient is "10 sprays = 20 cal"; 5 sprays = 10 cal.
    const db = seed(
      [{ name: 'avocado spray', amount: 5, unit: 'g', calories: 10, label_ingredient_id: 41 }],
      { id: 41, name: 'avocado spray', calories: 20, tracking_type: 'unit', unit_name: 'spray', serving_quantity: 10 }
    );
    expect(readRows(db)[0].unit).toBe('spray');
  });

  it('leaves weighed ingredients alone', () => {
    const db = seed(
      [{ name: 'greek yogurt', amount: 170, unit: 'g', calories: 100, label_ingredient_id: 8 }],
      { id: 8, name: 'greek yogurt', calories: 100, tracking_type: 'weight', grams_per_serving: 170 }
    );
    expect(readRows(db)[0].unit).toBe('g');
  });

  it('leaves a row alone when the calories do not match a count — the ingredient changed tracking type after it was logged', () => {
    // 170 g of something later switched to slice-tracking: reading it as
    // 170 slices would give 17,000 cal, nowhere near the stored 100.
    const db = seed(
      [{ name: 'bread', amount: 170, unit: 'g', calories: 100, label_ingredient_id: 13 }],
      { id: 13, name: 'bread', calories: 100, tracking_type: 'unit', unit_name: 'slice', serving_quantity: 1 }
    );
    expect(readRows(db)[0].unit).toBe('g');
  });

  it('does not touch rows with no library link', () => {
    const db = seed(
      [{ name: 'mystery', amount: 2, unit: 'g', calories: 140 }],
      { id: 4, name: 'eggs', calories: 70, tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1 }
    );
    expect(readRows(db)[0].unit).toBe('g');
  });

  it('is idempotent — a second boot changes nothing', () => {
    const db = seed(
      [{ name: 'eggs', amount: 3, unit: 'g', calories: 210, label_ingredient_id: 4 }],
      { id: 4, name: 'eggs', calories: 70, tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1 }
    );
    expect(readRows(db)[0].unit).toBe('egg');
    // A second pass finds nothing left to change and alters nothing.
    expect(repairLoggedIngredientUnits(db)).toBe(0);
    expect(readRows(db)[0].unit).toBe('egg');
    expect(readRows(db)[0].calories).toBe(210); // macros untouched
  });
});
