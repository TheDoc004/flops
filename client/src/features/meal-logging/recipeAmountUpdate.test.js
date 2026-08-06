import { describe, it, expect } from 'vitest';
import { amountsDifferFromRecipe } from './recipeAmountUpdate';
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
