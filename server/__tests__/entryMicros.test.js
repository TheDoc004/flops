const { createDb } = require('../db');
const { buildTestApp, createUser } = require('./helpers');
const reads = require('../mcp/reads');
const writes = require('../mcp/writes');

describe('get_micronutrient_totals Part B', () => {
  let db;
  let userId;
  let foodId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'micros@partb.test').id;
    const added = writes.addFoodItem(db, userId, {
      name: 'PartB Salmon',
      calories_per_100g: 200,
      protein_g_per_100g: 22,
      carbs_g_per_100g: 0,
      fat_g_per_100g: 12,
      nutrition_source: 'database',
      weight_basis: 'cooked',
      grams_per_serving: 100,
      micros_per_100g: { omega3_dha_mg: 500, omega3_epa_mg: 300 },
      micros_confidence: 'medium',
    });
    foodId = added.label_ingredient_id;
  });

  it('live-scales from ingredients and reports coverage + pct_of_daily_target', () => {
    const meal = writes.logMeal(db, userId, {
      date: '2026-09-20',
      weight_basis: 'cooked',
      name: 'Salmon bowl',
      items: [
        {
          label_ingredient_id: foodId,
          quantity_g: 100,
          nutrition_source: 'database',
        },
      ],
    });
    expect(meal.error).toBeUndefined();

    // Meal row itself has no frozen micros_json.
    const raw = db.prepare('SELECT micros_json, ingredients_json FROM log_entries WHERE id = ?').get(meal.entry.id);
    expect(raw.micros_json).toBeNull();
    expect(raw.ingredients_json).toBeTruthy();

    const shaped = meal.entry;
    expect(shaped.micros.omega3_dha_mg).toBe(500);
    expect(shaped.micros_source).toBe('ingredients');

    const totals = reads.getMicronutrientTotals(db, userId, '2026-09-20', '2026-09-20', {
      includeSupplements: false,
    });
    expect(totals.meals_total).toBe(1);
    expect(totals.meals_from_ingredients).toBe(1);
    expect(totals.meals_from_frozen).toBe(0);
    expect(totals.totals.omega3_dha_mg).toBe(500);
    expect(totals.coverage.ingredient_rows_with_micros).toBe(1);
    expect(totals.days).toBe(1);
    expect(totals.pct_of_daily_target.omega3_dha_mg).toBe(200); // 500/250
    expect(totals.daily_targets.omega3_dha_mg).toBe(250);
  });
});
