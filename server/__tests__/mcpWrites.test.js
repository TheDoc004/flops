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

  it('update_food_item persists micros_per_100g into micros_json (scaled to serving)', () => {
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 200, potassium_mg: 400 },
      micros_confidence: 'medium',
    });
    expect(r.error).toBeUndefined();
    expect(r.has_micros).toBe(true);
    const blob = JSON.parse(r.after.micros_json);
    // gps=100 → scale 1.0
    expect(blob.micros.sodium_mg).toBe(200);
    expect(blob.micros.potassium_mg).toBe(400);
    expect(blob.confidence).toBe('medium');
    expect(blob.version).toBe('v2');

    const row = db
      .prepare('SELECT micros_json FROM label_ingredients WHERE id = ?')
      .get(ingredientId);
    expect(JSON.parse(row.micros_json).micros.sodium_mg).toBe(200);
  });

  it('update_food_item scales micros_per_100g when grams_per_serving ≠ 100', () => {
    db.prepare(
      `UPDATE label_ingredients SET grams_per_serving = 50, serving_size_text = '50 g' WHERE id = ?`
    ).run(ingredientId);
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 200 },
      micros_confidence: 'high',
    });
    expect(r.error).toBeUndefined();
    const blob = JSON.parse(r.after.micros_json);
    expect(blob.micros.sodium_mg).toBe(100); // 200 * 50/100
    expect(blob.confidence).toBe('high');
  });

  it('update_food_item accepts micros per serving and clears with null', () => {
    const set = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros: { vitamin_d_mcg: 10 },
      micros_confidence: 'high',
    });
    expect(set.error).toBeUndefined();
    expect(JSON.parse(set.after.micros_json).micros.vitamin_d_mcg).toBe(10);
    expect(JSON.parse(set.after.micros_json).confidence).toBe('high');

    const cleared = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros: null,
    });
    expect(cleared.error).toBeUndefined();
    expect(cleared.after.micros_json).toBeNull();
    expect(cleared.has_micros).toBe(false);
  });

  it('update_food_item requires micros_confidence when writing micros', () => {
    const missing = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 100 },
    });
    expect(missing.error).toMatch(/micros_confidence/);
    expect(missing.after).toBeUndefined();

    const bad = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 100 },
      micros_confidence: 'super-high',
    });
    expect(bad.error).toMatch(/high\|medium\|low/);
  });

  it('add_food_item stores caller micros_confidence', () => {
    const r = writes.addFoodItem(db, userId, {
      name: 'USDA Broccoli Unique',
      calories_per_100g: 34,
      protein_g_per_100g: 2.8,
      carbs_g_per_100g: 7,
      fat_g_per_100g: 0.4,
      nutrition_source: 'database',
      weight_basis: 'raw',
      micros_per_100g: { vitamin_c_mg: 89, iron_mg: 0.7 },
      micros_confidence: 'medium',
    });
    expect(r.error).toBeUndefined();
    const blob = JSON.parse(r.food.micros_json);
    expect(blob.confidence).toBe('medium');
    expect(blob.micros.vitamin_c_mg).toBe(89);
  });

  it('update_food_item refuses micros_per_100g without usable grams_per_serving', () => {
    db.prepare(
      `UPDATE label_ingredients SET grams_per_serving = NULL WHERE id = ?`
    ).run(ingredientId);
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 100 },
      micros_confidence: 'medium',
    });
    expect(r.error).toMatch(/grams_per_serving/);
    expect(r.after).toBeUndefined();
  });

  it('update_food_item refuses unrecognized micros keys rather than storing null', () => {
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { not_a_real_nutrient: 99 },
      micros_confidence: 'medium',
    });
    expect(r.error).toMatch(/no recognized nutrient/);
    const row = db
      .prepare('SELECT micros_json FROM label_ingredients WHERE id = ?')
      .get(ingredientId);
    expect(row.micros_json).toBeNull();
  });

  it('write tools refuse unknown parameters (UNKNOWN_PARAM)', () => {
    const r = writes.updateFoodItem(db, userId, {
      label_ingredient_id: ingredientId,
      micros_per_100g: { sodium_mg: 50 },
      micros_confidence: 'medium',
      fake_field_that_looks_real: 123,
    });
    expect(r.error).toMatch(/does not accept parameter/);
    expect(r.code).toBe('UNKNOWN_PARAM');
    expect(r.unknown).toContain('fake_field_that_looks_real');
    const row = db
      .prepare('SELECT micros_json FROM label_ingredients WHERE id = ?')
      .get(ingredientId);
    expect(row.micros_json).toBeNull();
  });

  it('write_batch refuses unknown params inside nested ops', () => {
    const r = writes.writeBatch(db, userId, {
      operations: [
        {
          op: 'update_food_item',
          label_ingredient_id: ingredientId,
          calories_per_100g: 999, // not a valid update_food_item field
        },
      ],
    });
    expect(r.error).toMatch(/does not accept parameter/);
    expect(r.code).toBe('UNKNOWN_PARAM');
  });

  it('create_meal_prep saves an equal-split limited recipe with per-container macros', () => {
    const r = writes.createMealPrep(db, userId, {
      name: 'Chicken & Rice Prep',
      servings: 5,
      weight_basis: 'cooked',
      items: [
        { label_ingredient_id: ingredientId, quantity_g: 1000, nutrition_source: 'database' },
        {
          name: 'Cooked Jasmine Rice',
          quantity_g: 1000,
          calories_per_100g: 130,
          protein_g_per_100g: 2.7,
          carbs_g_per_100g: 28,
          fat_g_per_100g: 0.3,
          nutrition_source: 'database',
        },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.audit_id).toBeTruthy();
    expect(r.batch_totals.calories).toBe(2950);
    expect(r.per_serving.calories).toBe(590);
    expect(r.per_serving.protein_g).toBe(67.4);
    // Batch-sized grams must not trip the single-meal "unusually large" warning.
    expect(r.warnings.join(' ')).not.toMatch(/unusually large/);

    const recipe = r.recipe;
    expect(recipe.recipe_kind).toBe('limited');
    expect(recipe.remaining_uses).toBe(5);
    expect(recipe.max_uses).toBe(5);
    expect(recipe.serving_size).toBe('1 of 5 meal-prep servings');
    expect(recipe.meal_builder_meta).toMatchObject({ source: 'mcp_meal_prep', containers: 5, split: 'equal' });
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[0]).toMatchObject({
      kind: 'ingredient', amount: '200', unit: 'g', label_ingredient_id: ingredientId,
    });
    const riceId = r.result_row_ids.label_ingredient_ids[0];
    expect(recipe.ingredients[1]).toMatchObject({ kind: 'ingredient', amount: '200', label_ingredient_id: riceId });
    const rice = db.prepare('SELECT created_via FROM label_ingredients WHERE id = ?').get(riceId);
    expect(rice.created_via).toBe('mcp');

    // A container is loggable through log_meal.
    const logged = writes.logMeal(db, userId, {
      date: '2026-09-29',
      weight_basis: 'cooked',
      items: [{ recipe_id: recipe.id, servings: 1, nutrition_source: 'database' }],
    });
    expect(logged.error).toBeUndefined();
    expect(logged.entry.recipe_name).toBe('Chicken & Rice Prep');
  });

  it('create_meal_prep refuses recipe items, bad servings, and unknown params', () => {
    const base = {
      name: 'Prep',
      servings: 4,
      weight_basis: 'cooked',
      items: [{ label_ingredient_id: ingredientId, quantity_g: 800, nutrition_source: 'database' }],
    };
    expect(writes.createMealPrep(db, userId, { ...base, servings: 1 }).error).toMatch(/servings must be/);
    expect(writes.createMealPrep(db, userId, {
      ...base,
      items: [{ recipe_id: recipeId, servings: 1, nutrition_source: 'database' }],
    }).error).toMatch(/not recipes/);
    const unknown = writes.createMealPrep(db, userId, { ...base, max_uses: 4 });
    expect(unknown.code).toBe('UNKNOWN_PARAM');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE user_id = ? AND recipe_kind = 'limited'`).get(userId).n;
    expect(count).toBe(0);
  });

  it('create_meal_prep is revertible and works inside write_batch with refs', () => {
    const batch = writes.writeBatch(db, userId, {
      operations: [
        {
          op: 'add_food_item',
          ref: 'beans',
          name: 'Black Beans Cooked',
          calories_per_100g: 132,
          protein_g_per_100g: 8.9,
          carbs_g_per_100g: 23.7,
          fat_g_per_100g: 0.5,
          nutrition_source: 'database',
          weight_basis: 'cooked',
        },
        {
          op: 'create_meal_prep',
          name: 'Burrito Bowl Prep',
          servings: 4,
          weight_basis: 'cooked',
          items: [
            { ref: 'beans', quantity_g: 600, nutrition_source: 'database' },
            { label_ingredient_id: ingredientId, quantity_g: 800, nutrition_source: 'database' },
          ],
        },
      ],
    });
    expect(batch.error).toBeUndefined();
    const recipeIdNew = batch.result_row_ids.recipe_ids[0];
    expect(recipeIdNew).toBeTruthy();

    const rev = writes.revertMcpWrite(db, userId, { audit_id: batch.audit_id });
    expect(rev.ok).toBe(true);
    const row = db.prepare('SELECT is_deleted FROM recipes WHERE id = ?').get(recipeIdNew);
    expect(row.is_deleted).toBe(1);
    const beans = db.prepare(`SELECT id FROM label_ingredients WHERE name = 'Black Beans Cooked'`).get();
    expect(beans).toBeUndefined();
  });

  describe('meal prep countdown', () => {
    let prepId;
    const uses = () => db.prepare('SELECT remaining_uses, is_archived FROM recipes WHERE id = ?').get(prepId);
    const logContainer = (servings = 1) => writes.logMeal(db, userId, {
      date: '2026-09-30',
      weight_basis: 'cooked',
      items: [{ recipe_id: prepId, servings, nutrition_source: 'database' }],
    });

    beforeEach(() => {
      const r = writes.createMealPrep(db, userId, {
        name: 'Countdown Prep',
        servings: 3,
        weight_basis: 'cooked',
        items: [{ label_ingredient_id: ingredientId, quantity_g: 600, nutrition_source: 'database' }],
      });
      prepId = r.recipe.id;
    });

    it('log_meal takes one use per serving and archives at zero', () => {
      expect(logContainer().error).toBeUndefined();
      expect(uses()).toEqual({ remaining_uses: 2, is_archived: 0 });
      expect(logContainer(2).error).toBeUndefined();
      expect(uses()).toEqual({ remaining_uses: 0, is_archived: 1 });
      const none = logContainer();
      expect(none.code).toBe('LIMIT_USES');
      expect(reads.getDay(db, userId, '2026-09-30').meals).toHaveLength(2);
    });

    it('refuses more servings than uses left without writing', () => {
      const r = logContainer(4);
      expect(r.code).toBe('LIMIT_USES');
      expect(uses().remaining_uses).toBe(3);
      expect(reads.getDay(db, userId, '2026-09-30').meals).toHaveLength(0);
    });

    it('refuses mixing a prep container with other foods', () => {
      const r = writes.logMeal(db, userId, {
        date: '2026-09-30',
        weight_basis: 'cooked',
        items: [
          { recipe_id: prepId, servings: 1, nutrition_source: 'database' },
          { label_ingredient_id: ingredientId, quantity_g: 50, nutrition_source: 'database' },
        ],
      });
      expect(r.code).toBe('MEAL_PREP_MIXED');
      expect(uses().remaining_uses).toBe(3);
    });

    it('delete, revert and update hand uses back and re-charge them', () => {
      const logged = logContainer();
      const entryId = logged.entry.id;
      expect(uses().remaining_uses).toBe(2);

      const del = writes.deleteMealEntry(db, userId, { log_entry_id: entryId });
      expect(uses().remaining_uses).toBe(3);
      writes.revertMcpWrite(db, userId, { audit_id: del.audit_id });
      expect(uses().remaining_uses).toBe(2);

      const upd = writes.updateMealEntry(db, userId, {
        log_entry_id: entryId,
        items: [{ recipe_id: prepId, servings: 2, nutrition_source: 'database' }],
      });
      expect(upd.error).toBeUndefined();
      expect(uses().remaining_uses).toBe(1);
      writes.revertMcpWrite(db, userId, { audit_id: upd.audit_id });
      expect(uses().remaining_uses).toBe(2);

      writes.revertMcpWrite(db, userId, { audit_id: logged.audit_id });
      expect(uses()).toEqual({ remaining_uses: 3, is_archived: 0 });
    });

    it('un-archives an exhausted prep when a container is deleted', () => {
      const last = logContainer(3);
      expect(uses()).toEqual({ remaining_uses: 0, is_archived: 1 });
      writes.deleteMealEntry(db, userId, { log_entry_id: last.entry.id });
      expect(uses()).toEqual({ remaining_uses: 3, is_archived: 0 });
    });
  });

  it('proposals table is gone', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_proposals'`)
      .get();
    expect(row).toBeUndefined();
  });
});
