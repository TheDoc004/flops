import { describe, it, expect } from 'vitest';
import { filterRecipesByName, recipesForSelectPicker } from './recipeSearch';

describe('filterRecipesByName', () => {
  const recipes = [
    { id: 1, name: 'Apple Pie' },
    { id: 2, name: 'apple sauce' },
    { id: 3, name: 'Banana' },
  ];

  it('returns all sorted A–Z when query empty', () => {
    const r = filterRecipesByName(recipes, '');
    expect(r).toHaveLength(3);
    expect(r.map(x => x.name)).toEqual(
      [...recipes].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
      ).map(x => x.name)
    );
  });

  it('filters case-insensitive partial match', () => {
    const r = filterRecipesByName(recipes, 'APPLE');
    expect(r).toHaveLength(2);
    expect(r.map(x => x.id).sort()).toEqual([1, 2]);
  });

  it('prioritizes exact then starts-with then contains', () => {
    const r = filterRecipesByName(
      [
        { id: 1, name: 'Oats' },
        { id: 2, name: 'Soaked oats' },
        { id: 3, name: 'oatmeal' },
      ],
      'oat'
    );
    expect(r[0].name).toBe('oatmeal');
    expect(r.map(x => x.name)).toContain('Oats');
    expect(r.map(x => x.name)).toContain('Soaked oats');
  });
});

describe('recipesForSelectPicker', () => {
  it('prepends selected when filtered out', () => {
    const all = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ];
    const r = recipesForSelectPicker(all, 'nomatch', 2);
    expect(r[0].id).toBe(2);
    expect(r).toHaveLength(1);
  });
});
