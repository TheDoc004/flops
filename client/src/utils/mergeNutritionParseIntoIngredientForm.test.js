import { describe, expect, it } from 'vitest';
import { mergeNutritionParseIntoIngredientForm } from './mergeNutritionParseIntoIngredientForm';
import { parseNutritionFactsText } from './labelParse';

describe('mergeNutritionParseIntoIngredientForm', () => {
  it('merges parsed values and preserves base_label', () => {
    const prev = {
      name: '',
      base_label: 'Yogurt',
      brand_name: '',
      serving_size_text: '',
      grams_per_serving: '',
      calories: '',
      fat_g: '',
      carbs_g: '',
      protein_g: '',
      fiber_g: '',
    };
    const parsed = parseNutritionFactsText(`
      Nutrition Facts
      Serving size 1 container (150g)
      Calories 120
      Total Fat 4g
      Total Carbohydrate 12g
      Protein 15g
    `);
    const { next, scanFeedback } = mergeNutritionParseIntoIngredientForm(prev, parsed);
    expect(next.base_label).toBe('Yogurt');
    expect(next.calories).toBe('120');
    expect(next.fat_g).toBe('4');
    expect(next.carbs_g).toBe('12');
    expect(next.protein_g).toBe('15');
    expect(next.grams_per_serving).toBe('150');
    // Clean parses may have no review messages
    expect(scanFeedback === null || Array.isArray(scanFeedback)).toBe(true);
  });

  it('does not overwrite name when already set', () => {
    const prev = {
      name: 'My name',
      base_label: '',
      brand_name: '',
      serving_size_text: '',
      grams_per_serving: '',
      calories: '',
      fat_g: '',
      carbs_g: '',
      protein_g: '',
      fiber_g: '',
    };
    const parsed = parseNutritionFactsText(`Organic Milk\nNutrition Facts\nCalories 100\nTotal Fat 5g\nTotal Carbohydrate 8g\nProtein 8g`);
    const { next } = mergeNutritionParseIntoIngredientForm(prev, parsed);
    expect(next.name).toBe('My name');
  });
});
