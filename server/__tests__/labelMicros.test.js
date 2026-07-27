const { createDb } = require('../db');
const { labelMicrosForRows, mergeMicros, servingsMultiplier, storedMicros } = require('../labelMicros');

function seedIngredient(db, { id, name, micros, ...rest }) {
  db.prepare(
    `INSERT INTO label_ingredients
       (id, user_id, name, serving_size_text, calories, protein_g, carbs_g, fat_g,
        tracking_type, unit_name, serving_quantity, grams_per_serving, micros_json)
     VALUES (@id, 0, @name, '1 serving', 100, 0, 0, 0,
             @tracking_type, @unit_name, @serving_quantity, @grams_per_serving, @micros_json)`
  ).run({
    id,
    name,
    tracking_type: 'weight',
    unit_name: null,
    serving_quantity: null,
    grams_per_serving: null,
    micros_json: micros ? JSON.stringify({ micros, confidence: 'high', notes: 'From product label' }) : null,
    ...rest,
  });
}

describe('servingsMultiplier', () => {
  it('divides grams by the serving size for weighed ingredients', () => {
    expect(servingsMultiplier({ tracking_type: 'weight', grams_per_serving: 37 }, 74, 'g')).toBe(2);
  });

  it('converts ounces first', () => {
    const m = servingsMultiplier({ tracking_type: 'weight', grams_per_serving: 28.349523125 }, 2, 'oz');
    expect(m).toBeCloseTo(2, 6);
  });

  it('counts servings for unit-tracked ingredients', () => {
    expect(servingsMultiplier({ tracking_type: 'unit', serving_quantity: 1 }, 3)).toBe(3);
    // "10 sprays per serving" -> 5 sprays is half a serving.
    expect(servingsMultiplier({ tracking_type: 'unit', serving_quantity: 10 }, 5)).toBe(0.5);
  });

  it('gives up when a weighed ingredient has no serving size', () => {
    expect(servingsMultiplier({ tracking_type: 'weight', grams_per_serving: null }, 50, 'g')).toBeNull();
    expect(servingsMultiplier({ tracking_type: 'weight', grams_per_serving: 37 }, -1, 'g')).toBeNull();
  });
});

describe('storedMicros', () => {
  it('reads the flat values out of a stored blob', () => {
    expect(storedMicros(JSON.stringify({ micros: { iron_mg: 4.5, sodium_mg: 0 } }))).toEqual({ iron_mg: 4.5 });
  });
  it('returns null for anything unusable', () => {
    expect(storedMicros(null)).toBeNull();
    expect(storedMicros('not json')).toBeNull();
    expect(storedMicros(JSON.stringify({ micros: {} }))).toBeNull();
  });
});

describe('mergeMicros', () => {
  it('lets a measured value replace an estimate per nutrient', () => {
    const merged = mergeMicros({ iron_mg: 4.5 }, { iron_mg: 2, zinc_mg: 3 });
    // Iron was on a label, so the estimate loses; zinc had no label value.
    expect(merged).toEqual({ iron_mg: 4.5, zinc_mg: 3 });
  });

  it('works with either side missing', () => {
    expect(mergeMicros({ iron_mg: 4.5 }, null)).toEqual({ iron_mg: 4.5 });
    expect(mergeMicros(null, { zinc_mg: 3 })).toEqual({ zinc_mg: 3 });
    expect(mergeMicros(null, null)).toEqual({});
  });

  it('ignores keys that are not real nutrients', () => {
    expect(mergeMicros({ made_up_mg: 9 }, {})).toEqual({});
  });
});

describe('labelMicrosForRows', () => {
  it('scales a label ingredient by how much was logged', () => {
    const db = createDb(':memory:');
    seedIngredient(db, { id: 1, name: 'Cheerios', grams_per_serving: 37, micros: { iron_mg: 4.5, sodium_mg: 160 } });
    const { micros, covered, uncovered } = labelMicrosForRows(db, [
      { label_ingredient_id: 1, amount: 74, unit: 'g' }, // two servings
    ]);
    expect(micros).toEqual({ iron_mg: 9, sodium_mg: 320 });
    expect(covered).toHaveLength(1);
    expect(uncovered).toHaveLength(0);
  });

  it('sums across several label ingredients', () => {
    const db = createDb(':memory:');
    seedIngredient(db, { id: 1, name: 'A', grams_per_serving: 100, micros: { iron_mg: 2 } });
    seedIngredient(db, { id: 2, name: 'B', grams_per_serving: 100, micros: { iron_mg: 3, zinc_mg: 1 } });
    const { micros } = labelMicrosForRows(db, [
      { label_ingredient_id: 1, amount: 100, unit: 'g' },
      { label_ingredient_id: 2, amount: 100, unit: 'g' },
    ]);
    expect(micros).toEqual({ iron_mg: 5, zinc_mg: 1 });
  });

  it('separates rows with no label data so they can still be estimated', () => {
    const db = createDb(':memory:');
    seedIngredient(db, { id: 1, name: 'Labelled', grams_per_serving: 100, micros: { iron_mg: 2 } });
    seedIngredient(db, { id: 2, name: 'Bare', grams_per_serving: 100 }); // no micros stored
    const { micros, covered, uncovered } = labelMicrosForRows(db, [
      { label_ingredient_id: 1, amount: 100, unit: 'g' },
      { label_ingredient_id: 2, amount: 50, unit: 'g' },
      { name: 'handful of spinach' }, // free-text AI row
    ]);
    expect(micros).toEqual({ iron_mg: 2 });
    expect(covered).toHaveLength(1);
    expect(uncovered).toHaveLength(2);
  });

  it('treats an unresolvable amount as uncovered rather than guessing', () => {
    const db = createDb(':memory:');
    seedIngredient(db, { id: 1, name: 'No serving size', micros: { iron_mg: 2 } });
    const { micros, uncovered } = labelMicrosForRows(db, [{ label_ingredient_id: 1, amount: 50, unit: 'g' }]);
    expect(micros).toEqual({});
    expect(uncovered).toHaveLength(1);
  });

  it('handles an empty list', () => {
    const db = createDb(':memory:');
    expect(labelMicrosForRows(db, [])).toEqual({ micros: {}, covered: [], uncovered: [] });
  });
});
