import { describe, it, expect } from 'vitest';
import { buildLibraryBackedIngredients, isIngredientBuilt } from './recipeFromEstimate';

const row = (over = {}) => ({ name: 'Chicken breast', quantity: 200, unit: 'g', ...over });

describe('buildLibraryBackedIngredients', () => {
  it('turns a library-backed row into a named ingredient line', () => {
    const { ingredients, lines } = buildLibraryBackedIngredients([row()], [7]);
    expect(ingredients[0]).toEqual({
      kind: 'ingredient',
      name: 'Chicken breast',
      amount: '200',
      unit: 'g',
      label_ingredient_id: 7,
    });
    expect(lines[0]).toMatchObject({
      label_ingredient_id: 7,
      name: 'Chicken breast',
      amount: '200',
      unit: 'g',
    });
  });

  it('keeps a row with no library backing as a plain line', () => {
    const { ingredients, lines } = buildLibraryBackedIngredients([row()], [null]);
    expect(ingredients[0]).toEqual({ kind: 'line', name: 'Chicken breast', amount: '200 g' });
    expect(lines[0]).toEqual({});
  });

  it('keeps a row with no amount as a plain line', () => {
    const { ingredients } = buildLibraryBackedIngredients([row({ quantity: 0 })], [7]);
    expect(ingredients[0]).toEqual({ kind: 'line', name: 'Chicken breast', amount: 'as estimated' });
  });

  it('keeps ingredients and lines index-aligned when the two kinds mix', () => {
    const rows = [row({ name: 'Rice' }), row({ name: 'Salt', quantity: 0 }), row({ name: 'Oil' })];
    const { ingredients, lines } = buildLibraryBackedIngredients(rows, [3, null, 9]);
    expect(ingredients).toHaveLength(3);
    expect(lines).toHaveLength(3);
    expect(ingredients[1].kind).toBe('line');
    expect(lines[1]).toEqual({});
    expect(ingredients[2].label_ingredient_id).toBe(lines[2].label_ingredient_id);
  });

  it('normalizes ounces and preserves count units', () => {
    const { ingredients } = buildLibraryBackedIngredients(
      [row({ unit: 'ounces' }), row({ name: 'Egg', unit: 'egg' })],
      [1, 2]
    );
    expect(ingredients[0].unit).toBe('oz');
    expect(ingredients[1].unit).toBe('egg');
  });

  it('divides amounts across meal-prep servings', () => {
    const { ingredients, lines } = buildLibraryBackedIngredients([row({ quantity: 600 })], [7], 3);
    expect(ingredients[0].amount).toBe('200');
    expect(lines[0].amount).toBe('200');
  });

  it('skips nameless rows and survives junk input', () => {
    expect(buildLibraryBackedIngredients([{ name: '  ' }], [1]).ingredients).toEqual([]);
    expect(buildLibraryBackedIngredients(null, null).ingredients).toEqual([]);
  });
});

describe('isIngredientBuilt', () => {
  it('recognises recipes built from library ingredients', () => {
    expect(isIngredientBuilt({ meal_builder_meta: { source: 'ai_recipe', lines: [{ label_ingredient_id: 4 }] } })).toBe(true);
    expect(isIngredientBuilt({
      ingredients: [{ kind: 'ingredient', name: 'Egg', amount: '2', unit: 'egg', label_ingredient_id: 3 }],
    })).toBe(true);
  });

  it('rejects recipes with nothing editable behind them', () => {
    expect(isIngredientBuilt({ meal_builder_meta: { source: 'ai_recipe', lines: [{}, {}] } })).toBe(false);
    expect(isIngredientBuilt({ meal_builder_meta: null })).toBe(false);
    expect(isIngredientBuilt(undefined)).toBe(false);
  });
});
