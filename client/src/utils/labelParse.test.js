import { describe, it, expect } from 'vitest';
import { parseNutritionFactsText } from './labelParse';

describe('parseNutritionFactsText', () => {
  it('parses a typical US-style block', () => {
    const text = `
      Nutrition Facts
      Serving size 2/3 cup (55g)
      Calories 230
      Total Fat 8g
      Total Carbohydrate 37g
      Protein 3g
      Dietary Fiber 4g
    `;
    const p = parseNutritionFactsText(text);
    expect(p.serving_size_text).toMatch(/2\/3 cup/i);
    expect(p.grams_per_serving).toBe(55);
    expect(p.calories).toBe(230);
    expect(p.fat_g).toBe(8);
    expect(p.carbs_g).toBe(37);
    expect(p.protein_g).toBe(3);
    expect(p.fiber_g).toBe(4);
    expect(Array.isArray(p.scanWarnings)).toBe(true);
  });

  it('parses calories split across lines (OCR-style)', () => {
    const text = `Nutrition Facts
Serving size 1 cup (240ml)
Calories
120
Total Fat 5g
Total Carbohydrate 15g
Protein 8g`;
    const p = parseNutritionFactsText(text);
    expect(p.calories).toBe(120);
    expect(p.fat_g).toBe(5);
    expect(p.carbs_g).toBe(15);
    expect(p.protein_g).toBe(8);
  });

  it('tolerates noisy OCR like colored honey labels', () => {
    const text = `
      PURE HONEY
      Nutriti0n Facts
      Serv1ng Size 1 Tbsp (21g)
      Calor1es 60
      Total Fat 0g
      Total Carbohydrate 17g
      Protein 0g
    `;
    const p = parseNutritionFactsText(text);
    expect(p.calories).toBe(60);
    expect(p.carbs_g).toBe(17);
    expect(p.fieldStatus.calories).toBe('filled');
    expect(p.fieldStatus.carbs_g).toBe('filled');
  });

  it('does not invent values for <1g macros', () => {
    const text = `
      Nutrition Facts
      Serving size 1 tbsp
      Calories 10
      Total Fat <1g
      Total Carbohydrate 2g
      Protein <1g
    `;
    const p = parseNutritionFactsText(text);
    expect(p.fat_g).toBeNull();
    expect(p.protein_g).toBeNull();
    expect(p.carbs_g).toBe(2);
    expect(p.scanWarnings.some(w => w.includes('<1g'))).toBe(true);
  });
});
