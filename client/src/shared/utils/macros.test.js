import { describe, it, expect } from 'vitest';
import { computeEntryMacros, sumMacros, sumSupplementMacros, addMacroTotals, groupByDate, macroCaloriesFromGrams, mealMacroCalorieBreakdown } from './macros';

const makeEntry = (overrides = {}) => ({
  recipe_calories: 200,
  recipe_protein_g: 10,
  recipe_carbs_g: 30,
  recipe_fat_g: 5,
  servings: 1,
  date: '2026-04-09',
  ...overrides,
});

describe('macroCaloriesFromGrams', () => {
  it('uses 4/4/9 kcal per g for P/C/F', () => {
    const c = macroCaloriesFromGrams(10, 20, 10);
    expect(c.protein).toBe(40);
    expect(c.carbs).toBe(80);
    expect(c.fat).toBe(90);
  });
});

describe('mealMacroCalorieBreakdown', () => {
  it('matches grams from computeEntryMacros', () => {
    const entry = makeEntry({ servings: 2 });
    const m = computeEntryMacros(entry);
    const cal = mealMacroCalorieBreakdown(entry);
    expect(cal.protein + cal.carbs + cal.fat).toBeCloseTo(m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9);
  });
});

describe('computeEntryMacros', () => {
  it('multiplies all macros by servings', () => {
    const result = computeEntryMacros(makeEntry({ servings: 2 }));
    expect(result.calories).toBe(400);
    expect(result.protein_g).toBe(20);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(10);
  });

  it('handles fractional servings', () => {
    const result = computeEntryMacros(makeEntry({ servings: 0.5 }));
    expect(result.calories).toBe(100);
    expect(result.protein_g).toBe(5);
  });
});

describe('sumMacros', () => {
  it('sums macros across entries', () => {
    const result = sumMacros([makeEntry({ servings: 1 }), makeEntry({ servings: 1 })]);
    expect(result.calories).toBe(400);
    expect(result.protein_g).toBe(20);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(10);
  });

  it('returns zero totals for empty array', () => {
    expect(sumMacros([])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});

describe('sumSupplementMacros', () => {
  const supp = (over = {}) => ({
    id: 1, name: 'Whey', counts_toward_macros: 1,
    calories: 240, protein_g: 50, carbs_g: 6, fat_g: 3, ...over,
  });

  it('sums only supplements flagged to count toward macros', () => {
    const result = sumSupplementMacros([
      supp(),
      supp({ id: 2, name: 'Creatine', counts_toward_macros: 0, calories: 5, protein_g: 0, carbs_g: 0, fat_g: 0 }),
    ]);
    expect(result).toEqual({ calories: 240, protein_g: 50, carbs_g: 6, fat_g: 3 });
  });

  it('skips untaken rows when the row carries a taken flag (/today shape)', () => {
    expect(sumSupplementMacros([supp({ taken: 0 })])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(sumSupplementMacros([supp({ taken: 1 })]).calories).toBe(240);
  });

  it('counts range rows, which carry no taken flag', () => {
    expect(sumSupplementMacros([supp()]).calories).toBe(240);
  });

  it('returns zero totals for empty/missing input', () => {
    expect(sumSupplementMacros([])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(sumSupplementMacros(null)).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});

describe('addMacroTotals', () => {
  it('adds totals and tolerates missing ones', () => {
    const result = addMacroTotals(
      { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 },
      undefined,
      { calories: 240, protein_g: 50, carbs_g: 6, fat_g: 3 }
    );
    expect(result).toEqual({ calories: 2240, protein_g: 200, carbs_g: 206, fat_g: 63 });
  });
});

describe('groupByDate', () => {
  it('aggregates entries by date', () => {
    const entries = [
      makeEntry({ date: '2026-04-09', servings: 1 }),
      makeEntry({ date: '2026-04-09', servings: 1 }),
      makeEntry({ date: '2026-04-08', servings: 1 }),
    ];
    const result = groupByDate(entries);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.date === '2026-04-09').calories).toBe(400);
  });

  it('returns results sorted by date ascending', () => {
    const entries = [
      makeEntry({ date: '2026-04-10' }),
      makeEntry({ date: '2026-04-08' }),
      makeEntry({ date: '2026-04-09' }),
    ];
    const result = groupByDate(entries);
    expect(result[0].date).toBe('2026-04-08');
    expect(result[2].date).toBe('2026-04-10');
  });

  it('returns empty array for no entries', () => {
    expect(groupByDate([])).toEqual([]);
  });
});
