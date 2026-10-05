const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');
const { candidates } = require('../scripts/migrateUnitGramsPerUnit');

/**
 * Unit-tracked ingredients (eggs, slices) have ONE gram weight: grams_per_unit.
 * MCP must scale them through the same converter the app uses, so the micros
 * derived from the stored row agree with the macros — never a silent zero.
 */
describe('MCP unit-tracked ingredients', () => {
  let db;
  let userId;
  let eggId;

  const EGG_MICROS = { choline_mg: 146.9, selenium_mcg: 15.35, vitamin_a_mcg: 80 };

  function insertEgg({ gramsPerUnit = 50, gramsPerServing = null } = {}) {
    return db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type, unit_name, serving_quantity, grams_per_unit, weight_basis, micros_json
       ) VALUES (?, 'eggs', '1 egg', ?, 70, 6, 0.5, 5, 'manual', 'unit', 'egg', 1, ?, 'raw', ?)`
    ).run(
      userId, gramsPerServing, gramsPerUnit,
      JSON.stringify({ micros: EGG_MICROS, confidence: 'medium' })
    ).lastInsertRowid;
  }

  const logEggs = item => writes.logMeal(db, userId, {
    date: '2026-10-04',
    weight_basis: 'raw',
    name: 'Breakfast',
    items: [{ label_ingredient_id: eggId, nutrition_source: 'database', ...item }],
  });

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'eggs@mcp.test').id;
    eggId = insertEgg();
  });

  it('logs by count: stored as "4 egg", 280 cal, full egg micros', () => {
    const r = logEggs({ quantity: 4, unit: 'egg' });
    expect(r.error).toBeUndefined();
    const row = r.entry.ingredients[0];
    expect(row).toMatchObject({ amount: 4, unit: 'egg', label_ingredient_id: eggId, calories: 280 });
    expect(r.entry.micros).toMatchObject({ choline_mg: 587.6, selenium_mcg: 61.4, vitamin_a_mcg: 320 });
    expect(r.warnings.join(' ')).not.toMatch(/NOT counted/);
  });

  it('unit defaults to the ingredient\'s own unit', () => {
    const r = logEggs({ quantity: 2 });
    expect(r.entry.ingredients[0]).toMatchObject({ amount: 2, unit: 'egg', calories: 140 });
  });

  it('logs by grams via grams_per_unit with the same micros', () => {
    const r = logEggs({ quantity_g: 200 });
    expect(r.error).toBeUndefined();
    expect(r.entry.ingredients[0]).toMatchObject({ amount: 200, unit: 'g', calories: 280 });
    expect(r.entry.micros).toMatchObject({ choline_mg: 587.6, selenium_mcg: 61.4, vitamin_a_mcg: 320 });
  });

  it('refuses grams for a unit item with no grams_per_unit, even if grams_per_serving is set', () => {
    db.prepare('UPDATE label_ingredients SET grams_per_unit = NULL, grams_per_serving = 50 WHERE id = ?').run(eggId);
    const r = logEggs({ quantity_g: 200 });
    expect(r.code).toBe('UNIT_NOT_CONVERTIBLE');
    expect(r.error).toMatch(/no grams_per_unit/);
    expect(reads.getDay(db, userId, '2026-10-04').meals).toHaveLength(0);
    // Counting still works without a gram weight.
    expect(logEggs({ quantity: 4, unit: 'egg' }).entry.micros.choline_mg).toBe(587.6);
  });

  it('refuses giving both quantity and quantity_g', () => {
    expect(logEggs({ quantity: 4, quantity_g: 200 }).error).toMatch(/exactly one/);
  });

  it('warns (never silent) when a logged recipe line can\'t be scaled for micros', () => {
    db.prepare('UPDATE label_ingredients SET grams_per_unit = NULL WHERE id = ?').run(eggId);
    const recipeId = db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, ingredients)
       VALUES (?, 'Old egg plate', '1 serving', 280, 24, 2, 20, ?)`
    ).run(userId, JSON.stringify([
      { kind: 'ingredient', name: 'eggs', amount: '200', unit: 'g', label_ingredient_id: eggId },
    ])).lastInsertRowid;
    const r = writes.logMeal(db, userId, {
      date: '2026-10-04', weight_basis: 'raw',
      items: [{ recipe_id: recipeId, servings: 1, nutrition_source: 'database' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.entry.per_serving.calories).toBe(280);
    expect(r.warnings.join(' ')).toMatch(/Micros for recipe "Old egg plate" were NOT counted/);
  });

  it('search_ingredients reports grams_per_unit and derives grams_per_serving from it', () => {
    db.prepare('UPDATE label_ingredients SET grams_per_serving = 999 WHERE id = ?').run(eggId);
    const hit = reads.searchIngredients(db, userId, 'eggs')[0];
    expect(hit).toMatchObject({
      tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1, grams_per_unit: 50, grams_per_serving: 50,
    });
    expect(hit.per_100g.calories).toBe(140);
  });

  it('update_food_item: grams_per_unit on unit rows, grams_per_serving refused, micros_per_100g scaled by it', () => {
    expect(writes.updateFoodItem(db, userId, { label_ingredient_id: eggId, grams_per_serving: 50 }).code)
      .toBe('UNIT_TRACKED');
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: eggId,
      grams_per_unit: 60,
      micros_per_100g: { choline_mg: 100 },
      micros_confidence: 'medium',
    });
    expect(r.error).toBeUndefined();
    expect(r.after.grams_per_unit).toBe(60);
    expect(JSON.parse(r.after.micros_json).micros.choline_mg).toBe(60);
    writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(db.prepare('SELECT grams_per_unit FROM label_ingredients WHERE id = ?').get(eggId).grams_per_unit).toBe(50);
  });

  it('migration candidates: moves real weights, leaves placeholders', () => {
    db.prepare('UPDATE label_ingredients SET grams_per_unit = NULL, grams_per_serving = 50 WHERE id = ?').run(eggId);
    const placeholder = insertEgg({ gramsPerUnit: null, gramsPerServing: 1 });
    const rows = candidates(db);
    const egg = rows.find(r => r.id === eggId);
    expect(egg).toMatchObject({ new_grams_per_unit: 50, skipped: false });
    expect(rows.find(r => r.id === placeholder).skipped).toBe(true);
  });
});
