import { describe, it, expect } from 'vitest';
import {
  listRecipeIngredientLines,
  seedReceiptFromRecipe,
  seedReceiptFromLoggedSelections,
  sumReceiptMacros,
  receiptToApiIngredients,
  buildReceiptLine,
  persistAmountUnit,
} from './recipeReceipt';

const oats = {
  id: 1, name: 'Oats', tracking_type: 'weight', grams_per_serving: 40,
  calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3, fiber_g: 4,
};
const egg = {
  id: 3, name: 'Egg', tracking_type: 'unit', serving_quantity: 1, unit_name: 'egg',
  calories: 72, protein_g: 6, carbs_g: 0.4, fat_g: 5,
};
const labelById = { 1: oats, 3: egg };

describe('persistAmountUnit', () => {
  it('normalizes mass units and keeps count units', () => {
    expect(persistAmountUnit('ounces')).toBe('oz');
    expect(persistAmountUnit('g')).toBe('g');
    expect(persistAmountUnit('egg')).toBe('egg');
  });
});

describe('listRecipeIngredientLines', () => {
  it('reads kind:ingredient lines and migrates legacy slots to the default id', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '40', unit: 'g', label_ingredient_id: 1 },
        { kind: 'slot', slot_id: 's1', label: 'Eggs', amount: '2', unit: 'egg', option_label_ingredient_ids: [3, 9] },
      ],
    };
    expect(listRecipeIngredientLines(recipe)).toEqual([
      { label_ingredient_id: 1, name: 'Oats', amount: '40', unit: 'g' },
      { label_ingredient_id: 3, name: 'Eggs', amount: '2', unit: 'egg' },
    ]);
  });
});

describe('seedReceiptFromRecipe', () => {
  it('builds live receipt lines from the recipe template', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '80', unit: 'g', label_ingredient_id: 1 },
      ],
    };
    const lines = seedReceiptFromRecipe(recipe, labelById);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      label_ingredient_id: 1, name: 'Oats', amount: '80', unit: 'g', source: 'recipe',
    });
    expect(lines[0].calories).toBeCloseTo(300, 5);
  });

  it('applies remembered amounts when present', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '40', unit: 'g', label_ingredient_id: 1 },
      ],
    };
    const lines = seedReceiptFromRecipe(recipe, labelById, { 1: { amount: '80', unit: 'g' } });
    expect(lines[0].amount).toBe('80');
    expect(lines[0].calories).toBeCloseTo(300, 5);
  });
});

describe('seedReceiptFromLoggedSelections', () => {
  it('seeds from historical slot_selections substitutions and amounts, not the recipe', () => {
    const lines = seedReceiptFromLoggedSelections(
      { s1: { label_ingredient_id: 3, amount: '2', unit: 'egg' } },
      labelById
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label_ingredient_id: 3, name: 'Egg', amount: '2' });
    expect(lines[0].calories).toBeCloseTo(144, 5);
  });

  it('parses a JSON string and skips unknown ids', () => {
    const lines = seedReceiptFromLoggedSelections(
      JSON.stringify({ s1: { label_ingredient_id: 1, amount: 40, unit: 'g' }, s2: { label_ingredient_id: 99, amount: 10, unit: 'g' } }),
      labelById
    );
    expect(lines.map(l => l.label_ingredient_id)).toEqual([1]);
  });
});

describe('sumReceiptMacros + receiptToApiIngredients', () => {
  it('sums scaled macros and shapes the POST /api/log payload', () => {
    const oatsLine = buildReceiptLine(oats, 80, 'g');
    const eggLine = buildReceiptLine(egg, 2, 'egg');
    const tot = sumReceiptMacros([oatsLine, eggLine]);
    expect(tot.calories).toBeCloseTo(300 + 144, 5);
    expect(tot.protein_g).toBeCloseTo(10 + 12, 5);

    const payload = receiptToApiIngredients([oatsLine, eggLine]);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      name: 'Oats', amount: 80, unit: 'g', source: 'library', label_ingredient_id: 1,
    });
    expect(payload[1]).toMatchObject({
      name: 'Egg', amount: 2, label_ingredient_id: 3,
    });
  });

  it('drops zero-amount or unscalable rows from the API payload', () => {
    const empty = { name: 'Skip', amount: 0, calories: 10, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const noCal = { name: 'Notes', amount: 1, calories: null };
    expect(receiptToApiIngredients([empty, noCal])).toEqual([]);
  });
});
