const { createDb } = require('../db');
const { MICRO_KEYS } = require('../microNutrients');
const {
  isComplete,
  servingLine,
  completeIngredientMicros,
  backfillIngredientMicros,
} = require('../ingredientMicros');
const { resolveEntryMicros } = require('../entryMicros');

function seed(db, { id, name, micros = null, confidence = 'high', ...rest }) {
  db.prepare(
    `INSERT INTO label_ingredients
       (id, user_id, name, brand_name, serving_size_text, calories, protein_g, carbs_g, fat_g, fiber_g,
        tracking_type, unit_name, serving_quantity, grams_per_serving, grams_per_unit, micros_json)
     VALUES (@id, 1, @name, @brand_name, @serving_size_text, 120, 5, 25, 0, 1,
             @tracking_type, @unit_name, @serving_quantity, @grams_per_serving, @grams_per_unit, @micros_json)`
  ).run({
    id,
    name,
    brand_name: null,
    serving_size_text: '56 g',
    tracking_type: 'weight',
    unit_name: null,
    serving_quantity: null,
    grams_per_serving: 56,
    grams_per_unit: null,
    micros_json: micros ? JSON.stringify({ micros, confidence, notes: 'From product label' }) : null,
    ...rest,
  });
}

function stored(db, id) {
  return JSON.parse(db.prepare('SELECT micros_json FROM label_ingredients WHERE id = ?').get(id).micros_json);
}

const fakeEstimate = micros => jest.fn(async () => ({ micros, confidence: 'medium', notes: 'est' }));

describe('servingLine', () => {
  it('describes a weighed serving in grams, with macros as an anchor', () => {
    const line = servingLine({
      name: 'Sourdough', brand_name: "Trader Joe's", tracking_type: 'weight', grams_per_serving: 56,
      calories: 120, protein_g: 5, carbs_g: 25, fat_g: 0, fiber_g: 1,
    });
    expect(line.amount).toBe(56);
    expect(line.unit).toBe('g');
    expect(line.name).toContain("Trader Joe's");
    expect(line.name).toContain('120 kcal');
  });

  it('describes a counted serving by its unit and gram weight when known', () => {
    const line = servingLine({
      name: 'salmon filet', tracking_type: 'unit', unit_name: 'fillet', serving_quantity: 1, grams_per_unit: 113,
      calories: 140, protein_g: 23, carbs_g: 0, fat_g: 5,
    });
    expect(line).toMatchObject({ amount: 1, unit: 'fillet' });
    expect(line.name).toContain('113 g');
  });
});

describe('completeIngredientMicros', () => {
  it('fills a label blob\'s gaps without touching what the label measured', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 1, name: 'Sourdough', micros: { iron_mg: 1.7, calcium_mg: 20 } });
    const estimate = fakeEstimate({ iron_mg: 9, thiamin_mg: 0.4, sodium_mg: 300 });

    expect(await completeIngredientMicros(db, 1, 1, { estimate })).toBe('completed');
    const blob = stored(db, 1);
    expect(blob.micros.iron_mg).toBe(1.7); // label wins
    expect(blob.micros.calcium_mg).toBe(20);
    expect(blob.micros.thiamin_mg).toBe(0.4); // gap filled
    expect(blob.micros.sodium_mg).toBe(300);
    expect(blob.filled_keys.sort()).toEqual(['sodium_mg', 'thiamin_mg']);
    expect(blob.confidence).toBe('medium'); // no longer label-exact
    expect(blob.completed_at).toBeTruthy();
  });

  it('estimates from scratch when the ingredient has no micros', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 2, name: 'Blueberries', grams_per_serving: 100 });
    const estimate = fakeEstimate({ vitamin_c_mg: 9.7, vitamin_k_mcg: 19.3 });

    expect(await completeIngredientMicros(db, 1, 2, { estimate })).toBe('completed');
    expect(stored(db, 2).micros).toMatchObject({ vitamin_c_mg: 9.7, vitamin_k_mcg: 19.3 });
    expect(estimate.mock.calls[0][0][0]).toMatchObject({ amount: 100, unit: 'g' });
  });

  it('costs one call per ingredient: completed blobs are skipped', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 3, name: 'Apple' });
    const estimate = fakeEstimate({ vitamin_c_mg: 8 });
    await completeIngredientMicros(db, 1, 3, { estimate });
    expect(await completeIngredientMicros(db, 1, 3, { estimate })).toBe('skipped');
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('skips blobs that already carry every nutrient', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 4, name: 'Full', micros: Object.fromEntries(MICRO_KEYS.map(k => [k, 1])) });
    const estimate = fakeEstimate({ vitamin_c_mg: 8 });
    expect(await completeIngredientMicros(db, 1, 4, { estimate })).toBe('skipped');
    expect(estimate).not.toHaveBeenCalled();
  });

  it('never throws and leaves the row alone when the estimator fails', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 5, name: 'Bread', micros: { iron_mg: 1 } });
    const estimate = jest.fn(async () => { throw new Error('no provider'); });
    expect(await completeIngredientMicros(db, 1, 5, { estimate })).toBe('failed');
    expect(stored(db, 5).micros).toEqual({ iron_mg: 1 });
  });

  it('does not overwrite an edit made while the estimate was in flight', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 6, name: 'Feta', micros: { calcium_mg: 140 } });
    const estimate = jest.fn(async () => {
      db.prepare('UPDATE label_ingredients SET micros_json = ? WHERE id = 6')
        .run(JSON.stringify({ micros: { calcium_mg: 150 }, confidence: 'high' }));
      return { micros: { sodium_mg: 300 }, confidence: 'medium' };
    });
    expect(await completeIngredientMicros(db, 1, 6, { estimate })).toBe('skipped');
    expect(stored(db, 6).micros).toEqual({ calcium_mg: 150 });
  });
});

describe('backfillIngredientMicros', () => {
  it('completes every incomplete ingredient once', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 10, name: 'A' });
    seed(db, { id: 11, name: 'B', micros: { iron_mg: 1 } });
    const estimate = fakeEstimate({ zinc_mg: 1 });
    const counts = await backfillIngredientMicros(db, { estimate });
    expect(counts.completed).toBeGreaterThanOrEqual(2);
    expect(isComplete(db.prepare('SELECT micros_json FROM label_ingredients WHERE id = 10').get().micros_json)).toBe(true);

    const again = await backfillIngredientMicros(db, { estimate });
    expect(again.pending).toBe(0);
  });

  it('stops early when the estimator keeps failing', async () => {
    const db = createDb(':memory:');
    for (let i = 20; i < 26; i++) seed(db, { id: i, name: `X${i}` });
    const estimate = jest.fn(async () => null);
    const counts = await backfillIngredientMicros(db, { estimate });
    expect(counts.failed).toBe(3);
  });
});

describe('resolveEntryMicros — rows without library micros', () => {
  it('names the ingredients it could not count', () => {
    const db = createDb(':memory:');
    seed(db, { id: 30, name: 'Eggs', micros: { choline_mg: 147 }, grams_per_serving: 50 });
    seed(db, { id: 31, name: 'Blueberries' });
    const entry = {
      ingredients_json: JSON.stringify([
        { name: 'Eggs', amount: 100, unit: 'g', label_ingredient_id: 30 },
        { name: 'Blueberries, fresh', amount: 107, unit: 'g', label_ingredient_id: 31 },
      ]),
    };
    const { blob, coverage } = resolveEntryMicros(db, 1, entry);
    expect(blob.micros.choline_mg).toBe(294);
    expect(blob.missing_ingredients).toEqual(['Blueberries, fresh']);
    expect(blob.notes).toContain('Blueberries, fresh');
    expect(coverage.missing_ingredients).toEqual(['Blueberries, fresh']);
  });
});

describe('MCP getIngredient', () => {
  const reads = require('../mcp/reads');

  it('shows stored, estimated, zero and absent nutrients per serving and per 100g', async () => {
    const db = createDb(':memory:');
    seed(db, { id: 40, name: 'Pico', grams_per_serving: 30, micros: { sodium_mg: 120, vitamin_c_mg: 0 } });
    await completeIngredientMicros(db, 1, 40, { estimate: fakeEstimate({ potassium_mg: 60, vitamin_c_mg: 4 }) });

    const ing = reads.getIngredient(db, 1, 40);
    expect(ing.name).toBe('Pico');
    expect(ing.micros.per_serving).toMatchObject({ sodium_mg: 120, vitamin_c_mg: 0, potassium_mg: 60 });
    expect(ing.micros.per_100g.sodium_mg).toBe(400);
    expect(ing.micros.estimated_keys).toEqual(['potassium_mg']);
    expect(ing.micros.zero_keys).toEqual(['vitamin_c_mg']);
    expect(ing.micros.absent_keys).toContain('zinc_mg');
    expect(reads.getIngredient(db, 2, 40)).toBeNull(); // another user's row
  });
});

describe('servings_per_container via MCP', () => {
  const { buildTestApp, createUser } = require('./helpers');
  const reads = require('../mcp/reads');
  const writes = require('../mcp/writes');

  it('round-trips through add/update and reports the whole container', () => {
    const { db } = buildTestApp();
    const userId = createUser(db, 'container@test.test').id;
    const added = writes.addFoodItem(db, userId, {
      name: 'Frozen salmon portions', grams_per_serving: 113.4, servings_per_container: 8,
      calories_per_100g: 123, protein_g_per_100g: 20, carbs_g_per_100g: 0, fat_g_per_100g: 4.4,
      nutrition_source: 'label', weight_basis: 'raw',
    });
    expect(added.error).toBeUndefined();
    let ing = reads.getIngredient(db, userId, added.label_ingredient_id);
    expect(ing.servings_per_container).toBe(8);
    expect(ing.container).toEqual({ servings: 8, grams: 907.2 });

    const upd = writes.updateFoodItem(db, userId, { label_ingredient_id: added.label_ingredient_id, servings_per_container: null });
    expect(upd.error).toBeUndefined();
    ing = reads.getIngredient(db, userId, added.label_ingredient_id);
    expect(ing.container).toBeNull();
  });
});
