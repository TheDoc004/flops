import { describe, it, expect } from 'vitest';
import { addSubstituteOption, addIngredientToRecipe } from './recipePersist';

const RECIPE = {
  id: 10,
  name: 'Egg Toast Wombo Combo',
  serving_size: '1 meal',
  calories: 400, protein_g: 25, carbs_g: 40, fat_g: 12,
  ingredients: [
    { kind: 'slot', slot_id: 's1', label: 'Toast', amount: '90', unit: 'g', option_label_ingredient_ids: [1] },
    { kind: 'slot', slot_id: 's2', label: 'Egg', amount: '2', unit: 'egg', option_label_ingredient_ids: [3] },
  ],
  meal_builder_meta: {
    source: 'meal_builder',
    lines: [
      { label_ingredient_id: 1, name: 'Bread', amount: 90, unit: 'g', slot_id: 's1' },
      { label_ingredient_id: 3, name: 'Egg', amount: 2, unit: 'egg', slot_id: 's2' },
    ],
  },
};

describe('addSubstituteOption', () => {
  it('adds the ingredient as another option without changing the default', () => {
    const body = addSubstituteOption(RECIPE, 's1', 2);
    expect(body.ingredients[0].option_label_ingredient_ids).toEqual([1, 2]);
    expect(body.ingredients[1]).toEqual(RECIPE.ingredients[1]);
  });

  /* The recipe's own macros come from its default option, which didn't move. */
  it('leaves the recipe macros alone', () => {
    const body = addSubstituteOption(RECIPE, 's1', 2);
    expect(body).toMatchObject({ calories: 400, protein_g: 25, carbs_g: 40, fat_g: 12, serving_size: '1 meal' });
  });

  it('mirrors the option onto the meal_builder_meta line', () => {
    const body = addSubstituteOption(RECIPE, 's1', 2);
    expect(body.meal_builder_meta.lines[0].substitute_label_ingredient_ids).toEqual([2]);
    expect(body.meal_builder_meta.lines[1]).toEqual(RECIPE.meal_builder_meta.lines[1]);
  });

  it('returns null when the slot already offers that ingredient', () => {
    expect(addSubstituteOption(RECIPE, 's1', 1)).toBeNull();
  });

  it('returns null for an unknown slot or a bad id', () => {
    expect(addSubstituteOption(RECIPE, 'nope', 2)).toBeNull();
    expect(addSubstituteOption(RECIPE, 's1', 0)).toBeNull();
  });

  it('does not mutate the recipe it was given', () => {
    addSubstituteOption(RECIPE, 's1', 2);
    expect(RECIPE.ingredients[0].option_label_ingredient_ids).toEqual([1]);
    expect(RECIPE.meal_builder_meta.lines[0].substitute_label_ingredient_ids).toBeUndefined();
  });
});

describe('addIngredientToRecipe', () => {
  const row = { label_ingredient_id: 2, name: 'Sweet Potato, raw', amount: 200, unit: 'g', calories: 172, protein_g: 3.2, carbs_g: 40, fat_g: 0.2 };

  it('appends an editable slot and folds the macros into the recipe', () => {
    const body = addIngredientToRecipe(RECIPE, row);
    expect(body.ingredients).toHaveLength(3);
    expect(body.ingredients[2]).toMatchObject({
      kind: 'slot', label: 'Sweet Potato, raw', amount: '200', unit: 'g', option_label_ingredient_ids: [2],
    });
    expect(body).toMatchObject({ calories: 572, protein_g: 28.2, carbs_g: 80, fat_g: 12.2 });
  });

  it('keeps the meta line aligned with the new ingredient', () => {
    const body = addIngredientToRecipe(RECIPE, row);
    expect(body.meal_builder_meta.lines).toHaveLength(3);
    expect(body.meal_builder_meta.lines[2].slot_id).toBe(body.ingredients[2].slot_id);
  });

  /* Meta lines are paired with ingredients BY INDEX — appending to a ragged
     meta would attach the wrong line to the wrong ingredient. */
  it('leaves a misaligned meta untouched', () => {
    const ragged = { ...RECIPE, meal_builder_meta: { lines: [RECIPE.meal_builder_meta.lines[0]] } };
    const body = addIngredientToRecipe(ragged, row);
    expect(body.meal_builder_meta.lines).toHaveLength(1);
    expect(body.ingredients).toHaveLength(3);
  });

  it('refuses a row with no library backing or no amount', () => {
    expect(addIngredientToRecipe(RECIPE, { ...row, label_ingredient_id: undefined })).toBeNull();
    expect(addIngredientToRecipe(RECIPE, { ...row, amount: 0 })).toBeNull();
  });

  it('does not mutate the recipe it was given', () => {
    addIngredientToRecipe(RECIPE, row);
    expect(RECIPE.ingredients).toHaveLength(2);
    expect(RECIPE.meal_builder_meta.lines).toHaveLength(2);
  });
});
