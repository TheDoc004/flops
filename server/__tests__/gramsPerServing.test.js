const {
  MIN_GRAMS_PER_SERVING,
  isUsableGramsPerServing,
  normalizeGramsPerServingInput,
} = require('../gramsPerServing');
const { createDb, repairPlaceholderGramsPerServing } = require('../db');
const reads = require('../mcp/reads');
const writes = require('../mcp/writes');
const { buildTestApp, createUser } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('gramsPerServing helpers', () => {
  it('rejects placeholders below the floor', () => {
    expect(isUsableGramsPerServing(1)).toBe(false);
    expect(isUsableGramsPerServing(2.9)).toBe(false);
    expect(isUsableGramsPerServing(null)).toBe(false);
    expect(isUsableGramsPerServing(MIN_GRAMS_PER_SERVING)).toBe(true);
    expect(isUsableGramsPerServing(100)).toBe(true);
  });

  it('normalizeGramsPerServingInput returns null or errors', () => {
    expect(normalizeGramsPerServingInput(null)).toEqual({ value: null });
    expect(normalizeGramsPerServingInput(1).error).toMatch(/at least 3/);
    expect(normalizeGramsPerServingInput(40)).toEqual({ value: 40 });
  });
});

describe('per_100g derivation', () => {
  let db;
  let userId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'gps@test').id;
  });

  it('returns null for gps=1 and for genuine null (id-42 style)', () => {
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type
       ) VALUES
         (?, 'Rice Cake Bad', '1 cake', 1, 35, 1, 7, 0, 'manual', 'weight'),
         (?, 'Bagel Ok Null', '1 bagel', NULL, 260, 9, 50, 2, 'manual', 'unit')`
    ).run(userId, userId);

    const bad = reads.searchIngredients(db, userId, 'Rice Cake Bad')[0];
    const ok = reads.searchIngredients(db, userId, 'Bagel Ok Null')[0];
    expect(bad.per_100g).toBeNull();
    expect(ok.per_100g).toBeNull();
  });

  it('derives sane per_100g when gps is real', () => {
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
         source_type, tracking_type
       ) VALUES (?, 'Chicken', '100 g', 100, 165, 31, 0, 3.6, 'manual', 'weight')`
    ).run(userId);
    const row = reads.searchIngredients(db, userId, 'Chicken')[0];
    expect(row.per_100g.calories).toBe(165);
    expect(row.per_100g.calories).toBeLessThan(900);
  });
});

describe('MCP write guards for grams_per_serving', () => {
  let db;
  let userId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'gps-write@test').id;
  });

  it('add_food_item rejects grams_per_serving: 1', () => {
    const r = writes.addFoodItem(db, userId, {
      name: 'Bogus One Gram Food',
      calories_per_100g: 100,
      protein_g_per_100g: 1,
      carbs_g_per_100g: 1,
      fat_g_per_100g: 1,
      nutrition_source: 'label',
      weight_basis: 'raw',
      grams_per_serving: 1,
    });
    expect(r.error).toMatch(/at least 3/);
  });

  it('update_food_item can clear grams_per_serving to null', () => {
    const created = writes.addFoodItem(db, userId, {
      name: 'Clearable Food',
      calories_per_100g: 100,
      protein_g_per_100g: 1,
      carbs_g_per_100g: 1,
      fat_g_per_100g: 1,
      nutrition_source: 'label',
      weight_basis: 'cooked',
      grams_per_serving: 50,
    });
    const upd = writes.updateFoodItem(db, userId, {
      label_ingredient_id: created.label_ingredient_id,
      grams_per_serving: null,
    });
    expect(upd.error).toBeUndefined();
    expect(upd.after.grams_per_serving).toBeNull();
  });
});

describe('repairPlaceholderGramsPerServing', () => {
  it('nulls unit cosmetic ids and flips weight placeholders to unit', () => {
    const dbPath = path.join(os.tmpdir(), `flops-gps-${Date.now()}.db`);
    const db = createDb(dbPath);
    try {
      // Seed the eight production-shaped rows (ids may differ; insert then rewrite ids)
      const ins = db.prepare(
        `INSERT INTO label_ingredients (
           id, user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
           source_type, tracking_type, unit_name, serving_quantity
         ) VALUES (?, 0, ?, '1 serving', ?, 100, 1, 1, 1, 'manual', ?, ?, ?)`
      );
      ins.run(11, 'rice cakes', 1, 'weight', null, null);
      ins.run(13, 'whole wheat bread', 1, 'unit', 'slice', 1);
      ins.run(22, 'organic rice cakes', 1, 'weight', null, null);
      ins.run(27, 'tj sourdough', 1, 'unit', 'slice', 1);
      ins.run(28, 'tj tuna', 1, 'unit', 'can', 1);
      ins.run(29, 'kroger sourdough', 1, 'unit', 'slice', 1);
      ins.run(31, 'starkist tuna', 1, 'unit', 'can', 1);
      ins.run(34, 'onion bagel', 1, 'weight', null, null);
      ins.run(42, 'everything bagel', null, 'unit', 'bagel', 1);

      const result = repairPlaceholderGramsPerServing(db);
      expect(result.nulled).toBeGreaterThanOrEqual(5);
      expect(result.flipped).toBe(3);

      const byId = Object.fromEntries(
        db.prepare('SELECT id, tracking_type, grams_per_serving, unit_name FROM label_ingredients').all()
          .map(r => [r.id, r])
      );
      for (const id of [13, 27, 28, 29, 31]) {
        expect(byId[id].grams_per_serving).toBeNull();
        expect(byId[id].tracking_type).toBe('unit');
      }
      for (const id of [11, 22, 34]) {
        expect(byId[id].tracking_type).toBe('unit');
        expect(byId[id].grams_per_serving).toBeNull();
        expect(byId[id].unit_name).toBe('piece');
      }
      expect(byId[42].grams_per_serving).toBeNull();

      // Idempotent
      const again = repairPlaceholderGramsPerServing(db);
      expect(again.nulled).toBe(0);
      expect(again.flipped).toBe(0);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
