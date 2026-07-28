import { describe, it, expect } from 'vitest';
import { buildLibraryBackedIngredients, isIngredientBuilt } from './recipeFromEstimate';

const row = (over = {}) => ({ name: 'Chicken breast', quantity: 200, unit: 'g', ...over });

describe('buildLibraryBackedIngredients', () => {
  /**
   * The point of the whole change: a library-backed row must become a real
   * slot, not a text line, because slots are what Meal Builder can reopen and
   * what makes an ingredient swappable.
   */
  it('turns a library-backed row into an editable slot', () => {
    const { ingredients, lines } = buildLibraryBackedIngredients([row()], [7]);
    expect(ingredients[0]).toEqual({
      kind: 'slot',
      slot_id: 'ai_line_0',
      label: 'Chicken breast',
      amount: '200',
      unit: 'g',
      option_label_ingredient_ids: [7],
    });
    expect(lines[0]).toMatchObject({
      label_ingredient_id: 7,
      name: 'Chicken breast',
      role_label: 'Chicken breast',
      amount: '200',
      unit: 'g',
      slot_id: 'ai_line_0',
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
    // The server pairs these by index, so a gap must stay a placeholder.
    expect(ingredients[1].kind).toBe('line');
    expect(lines[1]).toEqual({});
    expect(ingredients[2].slot_id).toBe(lines[2].slot_id);
  });

  it('normalizes ounces and leaves other units as grams', () => {
    const { ingredients } = buildLibraryBackedIngredients(
      [row({ unit: 'ounces' }), row({ name: 'Milk', unit: 'ml' })],
      [1, 2]
    );
    expect(ingredients[0].unit).toBe('oz');
    expect(ingredients[1].unit).toBe('g');
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
  it('recognises recipes built from library ingredients, whatever made them', () => {
    expect(isIngredientBuilt({ meal_builder_meta: { source: 'ai_recipe', lines: [{ label_ingredient_id: 4 }] } })).toBe(true);
    expect(isIngredientBuilt({ meal_builder_meta: { source: 'meal_builder', lines: [{ label_ingredient_id: 4 }] } })).toBe(true);
  });

  it('rejects recipes with nothing editable behind them', () => {
    expect(isIngredientBuilt({ meal_builder_meta: { source: 'ai_recipe', lines: [{}, {}] } })).toBe(false);
    expect(isIngredientBuilt({ meal_builder_meta: null })).toBe(false);
    expect(isIngredientBuilt(undefined)).toBe(false);
  });
});
