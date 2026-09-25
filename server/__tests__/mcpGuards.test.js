const {
  nameSimilarity,
  findDuplicateMatches,
  DUPLICATE_SIMILARITY_THRESHOLD,
} = require('../mcp/similarity');
const { warningsForFoodMacros, warningsForMealTotals } = require('../mcp/warnings');
const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

describe('MCP similarity', () => {
  it('scores near-duplicate names highly', () => {
    expect(nameSimilarity('Olive Oil', 'olive oil')).toBe(1);
    expect(nameSimilarity('Olive Oil', 'Olive Oils')).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity('Chicken Breast', 'Whey Protein')).toBeLessThan(0.5);
  });

  it('findDuplicateMatches filters by threshold', () => {
    const matches = findDuplicateMatches(
      [{ id: 1, name: 'Olive Oil' }, { id: 2, name: 'Avocado' }],
      'olive oil',
      { threshold: DUPLICATE_SIMILARITY_THRESHOLD }
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(1);
  });
});

describe('MCP warnings', () => {
  it('flags null fiber when carbs imply fiber should exist', () => {
    const w = warningsForFoodMacros({
      name: 'Popcorn Kernels',
      calories: 375,
      protein_g: 12,
      carbs_g: 74,
      fat_g: 4,
      fiber_g: null,
      nutrition_source: 'label',
    });
    expect(w.some(x => /fiber/i.test(x))).toBe(true);
  });

  it('flags calorie vs 4/4/9 mismatch', () => {
    const w = warningsForMealTotals(
      { calories: 900, protein_g: 10, carbs_g: 10, fat_g: 10 },
      []
    );
    expect(w.some(x => /4\/4\/9|reconcil/i.test(x))).toBe(true);
  });

  it('flags huge oil quantities', () => {
    const w = warningsForMealTotals(
      { calories: 800, protein_g: 0, carbs_g: 0, fat_g: 90 },
      [{ name: 'Olive Oil', quantity_g: 900, macros: { calories: 800, protein_g: 0, carbs_g: 0, fat_g: 90 } }]
    );
    expect(w.some(x => /unit error|unusually large/i.test(x))).toBe(true);
  });
});

describe('MCP Phase 3 B guards + revert', () => {
  let db;
  let userId;
  let supplementId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'guards@mcp.test').id;
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
         source_type, tracking_type
       ) VALUES (?, 'Olive Oil', '100 g', 100, 884, 0, 0, 100, 0, 'manual', 'weight')`
    ).run(userId);
    db.prepare(
      `INSERT INTO supplements (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros,
         label_serving_qty, label_serving_unit, dose_qty, sort_order)
       VALUES (?, 'Kroger Multivitamin', '3 tablets', 0, 0, 0, 0, 0, 1, 'tablet', 3, 0)`
    ).run(userId);
    supplementId = db.prepare('SELECT id FROM supplements WHERE user_id = ?').get(userId).id;
  });

  it('add_food_item refuses near-duplicates without allow_duplicate', () => {
    const refused = writes.addFoodItem(db, userId, {
      name: 'olive oil',
      calories_per_100g: 884,
      protein_g_per_100g: 0,
      carbs_g_per_100g: 0,
      fat_g_per_100g: 100,
      nutrition_source: 'label',
      weight_basis: 'raw',
    });
    expect(refused.code).toBe('DUPLICATE_FOOD');
    expect(refused.matching?.length).toBeGreaterThan(0);

    const forced = writes.addFoodItem(db, userId, {
      name: 'olive oil',
      calories_per_100g: 884,
      protein_g_per_100g: 0,
      carbs_g_per_100g: 0,
      fat_g_per_100g: 100,
      nutrition_source: 'label',
      weight_basis: 'raw',
      allow_duplicate: true,
    });
    expect(forced.error).toBeUndefined();
    expect(forced.label_ingredient_id).toBeTruthy();
  });

  it('add_food_item with null fiber returns warning but still writes', () => {
    const r = writes.addFoodItem(db, userId, {
      name: 'Popcorn Kernels Fresh',
      calories_per_100g: 375,
      protein_g_per_100g: 12,
      carbs_g_per_100g: 74,
      fat_g_per_100g: 4,
      // fiber omitted
      nutrition_source: 'label',
      weight_basis: 'raw',
    });
    expect(r.error).toBeUndefined();
    expect(r.warnings.some(w => /fiber/i.test(w))).toBe(true);
  });

  it('update_supplement then revert_mcp_write restores multiplier', () => {
    const upd = writes.updateSupplement(db, userId, {
      supplement_id: supplementId,
      dose_qty: 1,
      dose_text: '1 tablet',
    });
    expect(upd.before.dose_multiplier).toBe(3);
    expect(upd.after.dose_multiplier).toBe(1);

    const recent = writes.listRecentMcpWrites(db, userId, 7);
    expect(recent.audits.some(a => a.audit_id === upd.audit_id)).toBe(true);

    const rev = writes.revertMcpWrite(db, userId, { audit_id: upd.audit_id });
    expect(rev.ok).toBe(true);
    const row = db
      .prepare('SELECT dose_qty FROM supplements WHERE id = ?')
      .get(supplementId);
    expect(row.dose_qty).toBe(3);
  });

  it('revert_mcp_write restores soft-deleted meal', () => {
    const oilId = db.prepare('SELECT id FROM label_ingredients WHERE user_id = ?').get(userId).id;
    const meal = writes.logMeal(db, userId, {
      date: '2026-09-25',
      weight_basis: 'raw',
      items: [{ label_ingredient_id: oilId, quantity_g: 10, nutrition_source: 'database' }],
    });
    const del = writes.deleteMealEntry(db, userId, { log_entry_id: meal.entry.id });
    expect(del.soft_deleted).toBe(true);
    expect(reads.getDay(db, userId, '2026-09-25').meals).toHaveLength(0);

    const rev = writes.revertMcpWrite(db, userId, { audit_id: del.audit_id });
    expect(rev.ok).toBe(true);
    expect(reads.getDay(db, userId, '2026-09-25').meals).toHaveLength(1);
    expect(reads.getDay(db, userId, '2026-09-25').meals[0].id).toBe(meal.entry.id);
  });
});
