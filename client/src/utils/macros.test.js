import { computeEntryMacros, sumMacros, groupByDate } from './macros';

const makeEntry = (overrides = {}) => ({
  recipe_calories: 200,
  recipe_protein_g: 10,
  recipe_carbs_g: 30,
  recipe_fat_g: 5,
  servings: 1,
  date: '2026-04-09',
  ...overrides,
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
