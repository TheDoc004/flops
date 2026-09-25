const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

describe('MCP Phase 3 direct writes', () => {
  let db;
  let userId;
  let ingredientId;
  let recipeId;
  let supplementId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'writer@mcp.test').id;
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
         source_type, tracking_type
       ) VALUES (?, 'Chicken Breast', '100 g', 100, 165, 31, 0, 3.6, 0, 'manual', 'weight')`
    ).run(userId);
    ingredientId = db.prepare('SELECT id FROM label_ingredients WHERE user_id = ?').get(userId).id;

    db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, is_quick_food)
       VALUES (?, 'Rice Bowl', '1 bowl', 450, 12, 70, 10, 4, '[]', 0)`
    ).run(userId);
    recipeId = db.prepare('SELECT id FROM recipes WHERE user_id = ? AND name = ?').get(userId, 'Rice Bowl').id;

    db.prepare(
      `INSERT INTO supplements (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros,
         label_serving_qty, label_serving_unit, dose_qty, sort_order)
       VALUES (?, 'Kroger Multivitamin', '3 tablets', 0, 0, 0, 0, 0, 1, 'tablet', 3, 0)`
    ).run(userId);
    supplementId = db.prepare('SELECT id FROM supplements WHERE user_id = ?').get(userId).id;
  });

  it('log_meal writes immediately and returns day totals + vs_goals', () => {
    for (const wd of [1, 2, 3, 4, 5, 6, 7]) {
      db.prepare(
        `INSERT INTO day_goal_versions (
           user_id, effective_start_date, weekday,
           calories_min, calories_max, protein_g_min, protein_g_max,
           carbs_g_min, carbs_g_max, fat_g_min, fat_g_max
         ) VALUES (?, '2026-01-01', ?, 1800, 2200, 140, 180, 180, 250, 50, 80)`
      ).run(userId, wd);
    }

    const r = writes.logMeal(db, userId, {
      date: '2026-09-25',
      weight_basis: 'cooked',
      name: 'Lunch',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 150,
          nutrition_source: 'database',
        },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.entry.source).toBe('mcp');
    expect(r.day.meal_totals.calories).toBeCloseTo(165 * 1.5, 0);
    expect(r.day.vs_goals).toBeTruthy();
    expect(r.day.vs_goals.calories).toBeTruthy();
    expect(reads.getDay(db, userId, '2026-09-25').meals).toHaveLength(1);
  });

  it('write_batch resolves refs and rolls back on failure', () => {
    const ok = writes.writeBatch(db, userId, {
      operations: [
        {
          op: 'add_food_item',
          ref: 'popcorn',
          name: 'Popcorn Kernels A',
          calories_per_100g: 375,
          protein_g_per_100g: 12,
          carbs_g_per_100g: 74,
          fat_g_per_100g: 4,
          nutrition_source: 'label',
          weight_basis: 'raw',
        },
        {
          op: 'add_food_item',
          ref: 'oil',
          name: 'Olive Oil A',
          calories_per_100g: 884,
          protein_g_per_100g: 0,
          carbs_g_per_100g: 0,
          fat_g_per_100g: 100,
          nutrition_source: 'label',
          weight_basis: 'raw',
        },
        {
          op: 'add_food_item',
          ref: 'salt',
          name: 'Sea Salt A',
          calories_per_100g: 0,
          protein_g_per_100g: 0,
          carbs_g_per_100g: 0,
          fat_g_per_100g: 0,
          nutrition_source: 'database',
          weight_basis: 'raw',
        },
        {
          op: 'log_meal',
          date: '2026-09-25',
          weight_basis: 'raw',
          name: 'Movie snacks',
          items: [
            { ref: 'popcorn', quantity_g: 40, nutrition_source: 'database' },
            { ref: 'oil', quantity_g: 10, nutrition_source: 'database' },
            { ref: 'salt', quantity_g: 1, nutrition_source: 'database' },
          ],
        },
      ],
    });
    expect(ok.error).toBeUndefined();
    expect(ok.refs.popcorn).toBeTruthy();
    expect(ok.refs.oil).toBeTruthy();
    expect(ok.refs.salt).toBeTruthy();
    expect(ok.result_row_ids.log_entry_ids).toHaveLength(1);
    expect(ok.day).toBeTruthy();

    const beforeFoods = db
      .prepare(`SELECT COUNT(*) AS n FROM label_ingredients WHERE user_id = ? AND created_via = 'mcp'`)
      .get(userId).n;

    const fail = writes.writeBatch(db, userId, {
      operations: [
        {
          op: 'add_food_item',
          ref: 'x',
          name: 'Should Roll Back',
          calories_per_100g: 100,
          protein_g_per_100g: 1,
          carbs_g_per_100g: 1,
          fat_g_per_100g: 1,
          nutrition_source: 'estimate',
          weight_basis: 'raw',
        },
        {
          op: 'log_meal',
          date: '2026-09-26',
          weight_basis: 'raw',
          items: [{ ref: 'missing', quantity_g: 10, nutrition_source: 'database' }],
        },
      ],
    });
    expect(fail.error).toMatch(/unknown ref|operations\[1\]/);
    const afterFoods = db
      .prepare(`SELECT COUNT(*) AS n FROM label_ingredients WHERE user_id = ? AND created_via = 'mcp'`)
      .get(userId).n;
    expect(afterFoods).toBe(beforeFoods);
    expect(reads.getDay(db, userId, '2026-09-26').meals).toHaveLength(0);
  });

  it('same operation_id twice creates one row', () => {
    const args = {
      date: '2026-09-27',
      weight_basis: 'raw',
      operation_id: 'op-once',
      items: [
        {
          recipe_id: recipeId,
          servings: 1,
          nutrition_source: 'database',
        },
      ],
    };
    const a = writes.logMeal(db, userId, args);
    const b = writes.logMeal(db, userId, args);
    expect(b.idempotent).toBe(true);
    expect(b.entry.id).toBe(a.entry.id);
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM log_entries WHERE user_id = ? AND source = 'mcp'`)
      .get(userId).n;
    expect(n).toBe(1);
  });

  it('update_supplement returns before/after dose_multiplier and appears in recent writes', () => {
    const r = writes.updateSupplement(db, userId, {
      supplement_id: supplementId,
      dose_qty: 1,
      dose_text: '1 tablet',
    });
    expect(r.before.dose_multiplier).toBe(3);
    expect(r.after.dose_multiplier).toBe(1);
    expect(r.after.dose_qty).toBe(1);

    const recent = writes.listRecentMcpWrites(db, userId, 7);
    expect(recent.audits.some(a => a.op === 'update_supplement' && a.audit_id === r.audit_id)).toBe(
      true
    );
  });

  it('delete_meal_entry soft-deletes and is revertible', () => {
    const logged = writes.logMeal(db, userId, {
      date: '2026-09-28',
      weight_basis: 'cooked',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 100,
          nutrition_source: 'database',
        },
      ],
    });
    const id = logged.entry.id;
    const del = writes.deleteMealEntry(db, userId, { log_entry_id: id });
    expect(del.soft_deleted).toBe(true);
    expect(del.permanent).toBeUndefined();
    const row = db.prepare('SELECT is_deleted FROM log_entries WHERE id = ?').get(id);
    expect(row.is_deleted).toBe(1);
    expect(reads.getDay(db, userId, '2026-09-28').meals).toHaveLength(0);

    const rev = writes.revertMcpWrite(db, userId, { audit_id: del.audit_id });
    expect(rev.ok).toBe(true);
    expect(reads.getDay(db, userId, '2026-09-28').meals[0].id).toBe(id);
  });

  it('weight_basis item overrides meal; library conflict is refused', () => {
    db.prepare('UPDATE label_ingredients SET weight_basis = ? WHERE id = ?').run('raw', ingredientId);
    const ok = writes.logMeal(db, userId, {
      date: '2026-09-26',
      weight_basis: 'cooked',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 100,
          nutrition_source: 'database',
          weight_basis: 'raw',
        },
      ],
    });
    expect(ok.error).toBeUndefined();
    expect(ok.entry.ingredients[0].weight_basis).toBe('raw');

    const bad = writes.logMeal(db, userId, {
      date: '2026-09-26',
      weight_basis: 'cooked',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 50,
          nutrition_source: 'database',
        },
      ],
    });
    expect(bad.error).toMatch(/conflicts with library/);
  });

  it('search_ingredients and list_supplements return library rows', () => {
    const foods = reads.searchIngredients(db, userId, 'chicken');
    expect(foods.some(f => f.id === ingredientId)).toBe(true);
    expect(foods[0].per_serving).toBeTruthy();
    expect(foods[0].per_100g).toBeTruthy();

    const sups = reads.listSupplements(db, userId);
    expect(sups.some(s => s.id === supplementId)).toBe(true);
    expect(sups[0].per_label_serving).toBeTruthy();
  });

  it('update_supplement can patch per-serving macros/micros with historical flag', () => {
    const r = writes.updateSupplement(db, userId, {
      supplement_id: supplementId,
      calories: 10,
      micros: { vitamin_d_mcg: 25 },
    });
    expect(r.error).toBeUndefined();
    expect(r.historical_totals_recalculate).toBe(true);
    expect(r.after.calories).toBe(10);
    expect(r.after.per_label_serving.micros.vitamin_d_mcg).toBe(25);

    const rev = writes.revertMcpWrite(db, userId, { audit_id: r.audit_id });
    expect(rev.ok).toBe(true);
    const restored = writes.updateSupplement
      ? db.prepare('SELECT calories FROM supplements WHERE id = ?').get(supplementId)
      : null;
    expect(restored.calories).toBe(0);
  });

  it('add_food_item writes immediately', () => {
    const r = writes.addFoodItem(db, userId, {
      name: 'Greek Yogurt Unique',
      calories_per_100g: 97,
      protein_g_per_100g: 9,
      carbs_g_per_100g: 4,
      fat_g_per_100g: 5,
      nutrition_source: 'label',
      weight_basis: 'raw',
    });
    expect(r.label_ingredient_id).toBeTruthy();
    expect(r.food.created_via).toBe('mcp');
  });

  it('proposals table is gone', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_proposals'`)
      .get();
    expect(row).toBeUndefined();
  });
});
