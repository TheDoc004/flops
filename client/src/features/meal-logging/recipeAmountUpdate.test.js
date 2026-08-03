import { describe, it, expect } from 'vitest';
import { amountsDifferFromRecipe, buildRecipeAmountUpdate } from './recipeAmountUpdate';
import { listLoggingSlotsFromRecipe } from './recipeLoggingSlots';

// 100g blueberries = 57 cal; 100g oats = 380 cal.
const labelById = {
  1: { id: 1, name: 'Blueberries', grams_per_serving: 100, calories: 57, protein_g: 0.7, carbs_g: 14.5, fat_g: 0.3, fiber_g: 2.4 },
  2: { id: 2, name: 'Oats', grams_per_serving: 100, calories: 380, protein_g: 13, carbs_g: 67, fat_g: 7, fiber_g: 10 },
  3: { id: 3, name: 'Egg', tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1, calories: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
};

/** Slot-based recipe: 60g blueberries + 50g oats. */
function makeRecipe() {
  return {
    id: 7,
    name: 'Oats bowl',
    serving_size: '1 meal',
    calories: 224.2, // 0.6*57 + 0.5*380
    protein_g: 6.92,
    carbs_g: 42.2,
    fat_g: 3.68,
    fiber_g: 6.44,
    ingredients: [
      { kind: 'slot', slot_id: 's1', label: 'Berries', amount: '60', unit: 'g', option_label_ingredient_ids: [1] },
      { kind: 'slot', slot_id: 's2', label: 'Grain', amount: '50', unit: 'g', option_label_ingredient_ids: [2] },
    ],
    meal_builder_meta: {
      source: 'meal_builder',
      lines: [
        { label_ingredient_id: 1, name: 'Blueberries', amount: 60, unit: 'g', slot_id: 's1' },
        { label_ingredient_id: 2, name: 'Oats', amount: 50, unit: 'g', slot_id: 's2' },
      ],
    },
  };
}

describe('amountsDifferFromRecipe', () => {
  const recipe = makeRecipe();
  const slots = listLoggingSlotsFromRecipe(recipe);

  it('is false when the log matches the recipe', () => {
    const amounts = { s1: { amount: '60', unit: 'g' }, s2: { amount: '50', unit: 'g' } };
    expect(amountsDifferFromRecipe(slots, amounts, labelById)).toBe(false);
  });

  it('is true once an amount is bumped', () => {
    const amounts = { s1: { amount: '100', unit: 'g' }, s2: { amount: '50', unit: 'g' } };
    expect(amountsDifferFromRecipe(slots, amounts, labelById)).toBe(true);
  });

  it('is true when only the unit changed', () => {
    const amounts = { s1: { amount: '60', unit: 'oz' }, s2: { amount: '50', unit: 'g' } };
    expect(amountsDifferFromRecipe(slots, amounts, labelById)).toBe(true);
  });

  it('ignores the g/oz picker for unit-tracked ingredients', () => {
    const unitRecipe = {
      ...recipe,
      ingredients: [{ kind: 'slot', slot_id: 's1', label: 'Eggs', amount: '2', unit: 'egg', option_label_ingredient_ids: [3] }],
      meal_builder_meta: null,
    };
    const unitSlots = listLoggingSlotsFromRecipe(unitRecipe);
    expect(amountsDifferFromRecipe(unitSlots, { s1: { amount: '2', unit: 'g' } }, labelById)).toBe(false);
    expect(amountsDifferFromRecipe(unitSlots, { s1: { amount: '3', unit: 'g' } }, labelById)).toBe(true);
  });
});

describe('buildRecipeAmountUpdate', () => {
  it('writes the new amounts into slots, meta and macros', () => {
    const recipe = makeRecipe();
    const slots = listLoggingSlotsFromRecipe(recipe);
    const amounts = { s1: { amount: '100', unit: 'g' }, s2: { amount: '50', unit: 'g' } };

    const body = buildRecipeAmountUpdate(recipe, slots, amounts, labelById);

    expect(body.ingredients[0]).toMatchObject({ slot_id: 's1', amount: '100', unit: 'g' });
    expect(body.ingredients[1]).toMatchObject({ slot_id: 's2', amount: '50', unit: 'g' });
    expect(body.meal_builder_meta.lines[0]).toMatchObject({ amount: 100, unit: 'g' });
    // 1.0*57 + 0.5*380 = 247
    expect(body.calories).toBeCloseTo(247, 1);
    expect(body.name).toBe('Oats bowl');
    expect(body.serving_size).toBe('1 meal');
  });

  it('recomputes from the default ingredient, ignoring a substitution', () => {
    const recipe = makeRecipe();
    recipe.ingredients[0].option_label_ingredient_ids = [1, 2]; // blueberries or oats
    const slots = listLoggingSlotsFromRecipe(recipe);
    const amounts = { s1: { amount: '60', unit: 'g' }, s2: { amount: '50', unit: 'g' } };

    const body = buildRecipeAmountUpdate(recipe, slots, amounts, labelById);
    // Unchanged amounts + default ingredients = the recipe's own macros.
    expect(body.calories).toBeCloseTo(224.2, 1);
  });

  it('converts oz amounts when recomputing macros', () => {
    const recipe = makeRecipe();
    const slots = listLoggingSlotsFromRecipe(recipe);
    const amounts = { s1: { amount: '1', unit: 'oz' }, s2: { amount: '50', unit: 'g' } };

    const body = buildRecipeAmountUpdate(recipe, slots, amounts, labelById);
    expect(body.ingredients[0]).toMatchObject({ amount: '1', unit: 'oz' });
    // 28.35g blueberries (16.2 cal) + 190 cal of oats
    expect(body.calories).toBeCloseTo(206.2, 0);
  });

  it('returns null when an amount is zero or missing', () => {
    const recipe = makeRecipe();
    const slots = listLoggingSlotsFromRecipe(recipe);
    expect(buildRecipeAmountUpdate(recipe, slots, { s1: { amount: '0', unit: 'g' } }, labelById)).toBeNull();
  });

  it('returns null when an ingredient cannot be rescaled', () => {
    const recipe = makeRecipe();
    const slots = listLoggingSlotsFromRecipe(recipe);
    const noGrams = { ...labelById, 1: { ...labelById[1], grams_per_serving: 0 } };
    const amounts = { s1: { amount: '100', unit: 'g' }, s2: { amount: '50', unit: 'g' } };
    expect(buildRecipeAmountUpdate(recipe, slots, amounts, noGrams)).toBeNull();
  });

  it('updates the display text of legacy Meal Builder line rows', () => {
    const legacy = {
      id: 9,
      name: 'Legacy bowl',
      serving_size: '1 meal',
      calories: 57, protein_g: 0.7, carbs_g: 14.5, fat_g: 0.3, fiber_g: 2.4,
      ingredients: [{ kind: 'line', name: 'Blueberries', amount: '100 g' }],
      meal_builder_meta: { source: 'meal_builder', lines: [{ label_ingredient_id: 1, name: 'Blueberries', amount: 100, unit: 'g' }] },
    };
    const slots = listLoggingSlotsFromRecipe(legacy);
    const body = buildRecipeAmountUpdate(legacy, slots, { [slots[0].slot_id]: { amount: '150', unit: 'g' } }, labelById);

    expect(body.ingredients[0].amount).toBe('150 g');
    expect(body.meal_builder_meta.lines[0].amount).toBe(150);
    expect(body.calories).toBeCloseTo(85.5, 1);
  });
});
