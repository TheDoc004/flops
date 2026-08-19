import { describe, it, expect } from 'vitest';
import { addIngredientToRecipe } from './recipePersist';

const RECIPE = {
  id: 10,
  name: 'Egg Toast Wombo Combo',
  serving_size: '1 meal',
  calories: 400, protein_g: 25, carbs_g: 40, fat_g: 12,
  ingredients: [
    { kind: 'ingredient', name: 'Toast', amount: '90', unit: 'g', label_ingredient_id: 1 },
    { kind: 'ingredient', name: 'Egg', amount: '2', unit: 'egg', label_ingredient_id: 3 },
  ],
  meal_builder_meta: { source: 'meal_builder' },
};

describe('addIngredientToRecipe', () => {
  const row = { label_ingredient_id: 2, name: 'Sweet Potato, raw', amount: 200, unit: 'g', calories: 172, protein_g: 3.2, carbs_g: 40, fat_g: 0.2 };

  it('appends a named ingredient line and folds the macros into the recipe', () => {
    const body = addIngredientToRecipe(RECIPE, row);
    expect(body.ingredients).toHaveLength(3);
    expect(body.ingredients[2]).toMatchObject({
      kind: 'ingredient', name: 'Sweet Potato, raw', amount: '200', unit: 'g', label_ingredient_id: 2,
    });
    expect(body).toMatchObject({ calories: 572, protein_g: 28.2, carbs_g: 80, fat_g: 12.2 });
  });

  it('does not dual-write the new amount into meal_builder_meta.lines', () => {
    const body = addIngredientToRecipe(RECIPE, row);
    expect(body.meal_builder_meta).toEqual({ source: 'meal_builder' });
    expect(body.meal_builder_meta.lines).toBeUndefined();
  });

  it('refuses a row with no library backing or no amount', () => {
    expect(addIngredientToRecipe(RECIPE, { ...row, label_ingredient_id: undefined })).toBeNull();
    expect(addIngredientToRecipe(RECIPE, { ...row, amount: 0 })).toBeNull();
  });

  it('does not mutate the recipe it was given', () => {
    addIngredientToRecipe(RECIPE, row);
    expect(RECIPE.ingredients).toHaveLength(2);
  });
});
