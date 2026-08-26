import { describe, it, expect } from 'vitest';
import {
  listRecipeIngredientLines,
  seedReceiptFromRecipe,
  seedReceiptFromLoggedSelections,
  sumReceiptMacros,
  receiptToApiIngredients,
  buildReceiptLine,
  persistAmountUnit,
  changeLineUnit,
  retargetLineToIngredient,
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

// Nonfat milk recorded as "1 cup", one cup weighed at 245 g.
const milk = {
  id: 7, name: 'Nonfat milk', tracking_type: 'unit', unit_name: 'cup',
  serving_quantity: 1, grams_per_unit: 245,
  calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5,
};

describe('changeLineUnit', () => {
  const line = buildReceiptLine(milk, '1', 'cup');

  it('restates the amount so the food stays the same', () => {
    expect(changeLineUnit(line, milk, 'ml')).toEqual({ amount: '236.59', unit: 'ml' });
    expect(changeLineUnit(line, milk, 'g')).toEqual({ amount: '245', unit: 'g' });
    expect(changeLineUnit(line, milk, 'fl oz')).toEqual({ amount: '8', unit: 'fl oz' });
  });

  it('round-trips back to the original unit', () => {
    const inMl = { ...line, ...changeLineUnit(line, milk, 'ml') };
    expect(Number(changeLineUnit(inMl, milk, 'cup').amount)).toBeCloseTo(1, 4);
  });

  it('keeps the macros right after the switch', () => {
    const patch = changeLineUnit(line, milk, 'ml');
    const converted = buildReceiptLine(milk, patch.amount, patch.unit);
    expect(converted.calories).toBeCloseTo(90, 1);
    // Half a cup is half the macros, whatever unit says so.
    const half = buildReceiptLine(milk, '118.29', 'ml');
    expect(half.calories).toBeCloseTo(45, 1);
  });

  it('refuses a unit the ingredient cannot be measured in', () => {
    expect(changeLineUnit(line, milk, 'slice')).toBeNull();
    expect(changeLineUnit(line, oats, 'ml')).toBeNull(); // grams-per-serving: no density
  });
});

describe('retargetLineToIngredient', () => {
  it('keeps the amount when the new ingredient takes the same unit', () => {
    const line = buildReceiptLine(oats, '150', 'g');
    expect(retargetLineToIngredient(line, { ...oats, id: 2 })).toEqual({ amount: '150', unit: 'g' });
  });

  it('resets rather than relabelling an amount onto a foreign unit', () => {
    // "150 g" must not become "150 eggs" just because the swap was accepted.
    const line = buildReceiptLine(oats, '150', 'g');
    expect(retargetLineToIngredient(line, egg)).toEqual({ amount: '1', unit: 'egg' });
  });

  it('carries a weight across to an ingredient that knows what one weighs', () => {
    const line = buildReceiptLine(oats, '245', 'g');
    expect(retargetLineToIngredient(line, milk)).toEqual({ amount: '245', unit: 'g' });
  });
});
