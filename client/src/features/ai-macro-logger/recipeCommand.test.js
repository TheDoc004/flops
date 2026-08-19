import { describe, it, expect } from 'vitest';
import { matchRecipe, applyModifications, resolvedReviewRows, resolveModification, mergeRecipeModifications } from './recipeCommand';

/* A saved ingredient as the library API returns it (weight-tracked unless told otherwise). */
const lib = (id, name, over = {}) => ({
  id, name, tracking_type: 'weight', grams_per_serving: 100,
  calories: 100, protein_g: 5, carbs_g: 20, fat_g: 1, ...over,
});

const SWEET_POTATO = lib(2, 'Sweet Potato, raw', { calories: 86, protein_g: 1.6, carbs_g: 20, fat_g: 0.1 });
const BREAD = lib(1, 'Dave’s Killer Bread', { grams_per_serving: 45, calories: 110, protein_g: 5, carbs_g: 22, fat_g: 1.5 });
const EGGS = lib(3, 'Large egg', { tracking_type: 'unit', serving_quantity: 1, unit_name: 'egg', calories: 72, protein_g: 6, carbs_g: 0.4, fat_g: 5 });

const LIBRARY = [BREAD, SWEET_POTATO, EGGS];
const byId = new Map(LIBRARY.map(i => [i.id, i]));
const byName = new Map(LIBRARY.map(i => [i.name.toLowerCase(), i]));

/** Recipe with one library-backed ingredient (bread) and one name-only line. */
const RECIPE = {
  id: 10,
  name: 'Egg Toast Wombo Combo',
  ingredients: [
    { kind: 'ingredient', name: 'Toast', amount: '90', unit: 'g', label_ingredient_id: 1 },
    { kind: 'line', name: 'Everything seasoning', amount: 'a pinch' },
  ],
};

const apply = mods => applyModifications(RECIPE, mods, byId, byName);
const toastLine = r => r.resolvedLines.find(l => l.key === 'line_0');

describe('matchRecipe', () => {
  const recipes = [{ id: 1, name: 'Egg Toast Wombo Combo' }, { id: 2, name: 'Chicken and rice' }];

  it('matches on exact name regardless of case', () => {
    expect(matchRecipe('egg toast wombo combo', recipes).recipe.id).toBe(1);
  });

  it('matches fuzzily on a partial name', () => {
    expect(matchRecipe('Egg Toast', recipes).recipe.id).toBe(1);
  });

  it('reports no match rather than guessing', () => {
    expect(matchRecipe('Beef stew', recipes).status).toBe('none');
  });
});

describe('applyModifications — substitutes', () => {
  it('substitutes with any library ingredient', () => {
    const r = apply([{ type: 'substitute', target: 'Toast', newName: 'Sweet Potato, raw', quantity: 200, unit: 'g' }]);
    expect(toastLine(r)).toMatchObject({ label_ingredient_id: 2, amount: '200', unit: 'g' });
    expect(r.requiresCustomPath).toBe(false);
    expect(r.unapplied).toEqual([]);
    expect(r.keepable.some(k => k.kind === 'option')).toBe(false);
  });

  it('resolves a loosely worded substitute to the saved ingredient', () => {
    const r = apply([{ type: 'substitute', target: 'Toast', newName: 'sweet potato', quantity: 200, unit: 'g' }]);
    expect(toastLine(r).label_ingredient_id).toBe(2);
    expect(r.applied[0]).toContain('Sweet Potato, raw');
  });

  it('keeps the line amount when the substitute comes with no quantity', () => {
    const r = apply([{ type: 'substitute', target: 'Toast', newName: 'sweet potato' }]);
    expect(toastLine(r)).toMatchObject({ label_ingredient_id: 2, amount: '90', unit: 'g' });
  });

  it('falls back to the AI estimate when nothing in the library matches', () => {
    const r = apply([
      { type: 'substitute', target: 'Toast', newName: 'Sourdough boule', quantity: 80, unit: 'g', calories: 210, protein: 8, carbs: 42, fat: 1 },
    ]);
    expect(toastLine(r).amount).toBe('0');
    expect(r.addedRows).toEqual([
      { name: 'Sourdough boule', amount: 80, unit: 'g', calories: 210, protein_g: 8, carbs_g: 42, fat_g: 1, source: 'ai' },
    ]);
    expect(r.requiresCustomPath).toBe(true);
  });

  it('does not scale a per-unit ingredient by weight', () => {
    const r = apply([
      { type: 'substitute', target: 'Toast', newName: 'Large egg', quantity: 200, unit: 'g', calories: 140, protein: 12, carbs: 1, fat: 10 },
    ]);
    expect(r.addedRows[0]).toMatchObject({ name: 'Large egg', source: 'ai' });
  });

  it('surfaces a substitute it can neither match nor estimate', () => {
    const r = apply([{ type: 'substitute', target: 'Toast', newName: 'Sourdough boule' }]);
    expect(r.addedRows).toEqual([]);
    expect(r.unapplied[0].text).toContain('Sourdough boule');
  });
});

describe('applyModifications — adds', () => {
  it('adds a library ingredient with its saved macros and id', () => {
    const r = apply([{ type: 'add', newName: 'sweet potato', quantity: 150, unit: 'g' }]);
    expect(r.addedRows[0]).toEqual({
      name: 'Sweet Potato, raw', amount: 150, unit: 'g',
      calories: 129, protein_g: 2.4, carbs_g: 30, fat_g: 0.2,
      source: 'library', label_ingredient_id: 2,
    });
    expect(r.requiresCustomPath).toBe(true);
    expect(r.keepable).toEqual([
      expect.objectContaining({ kind: 'ingredient', label: 'Add Sweet Potato, raw to the recipe' }),
    ]);
  });

  it('defaults to one serving when the add has no amount', () => {
    const r = apply([{ type: 'add', newName: 'Large egg' }]);
    expect(r.addedRows[0]).toMatchObject({ name: 'Large egg', amount: 1, unit: 'egg', calories: 72 });
  });

  it('adds an unknown ingredient from the AI estimate', () => {
    const r = apply([{ type: 'add', newName: 'BBQ sauce', quantity: 30, unit: 'g', calories: 20, carbs: 5 }]);
    expect(r.addedRows[0]).toMatchObject({ name: 'BBQ sauce', calories: 20, carbs_g: 5, source: 'ai' });
  });

  it('surfaces an add with no macros instead of logging it as zero', () => {
    const r = apply([{ type: 'add', newName: 'Furikake', quantity: 5, unit: 'g' }]);
    expect(r.addedRows).toEqual([]);
    expect(r.unapplied[0].reason).toContain('couldn’t estimate');
  });
});

describe('applyModifications — name-only template lines', () => {
  it('removes a name-only line', () => {
    const r = apply([{ type: 'remove', target: 'Everything seasoning' }]);
    expect(r.droppedLines.has('Everything seasoning')).toBe(true);
    expect(resolvedReviewRows(RECIPE, byId, r.resolvedLines, r.droppedLines).map(x => x.name))
      .toEqual(['Dave’s Killer Bread']);
  });

  it('swaps a name-only line for a library ingredient', () => {
    const r = apply([{ type: 'substitute', target: 'Everything seasoning', newName: 'sweet potato', quantity: 100, unit: 'g' }]);
    expect(r.droppedLines.has('Everything seasoning')).toBe(true);
    expect(r.addedRows[0]).toMatchObject({ name: 'Sweet Potato, raw', label_ingredient_id: 2 });
    expect(r.requiresCustomPath).toBe(true);
  });

  it('still reports a target that is in neither the library lines nor the notes', () => {
    const r = apply([{ type: 'remove', target: 'Bacon' }]);
    expect(r.unapplied[0].reason).toContain('isn’t in this recipe');
  });
});

describe('resolving an unapplied change by hand', () => {
  it('tags a fixable item with the modification it came from', () => {
    const mods = [{ type: 'add', newName: 'Furikake', quantity: 5, unit: 'g' }];
    const [u] = apply(mods).unapplied;
    expect(u.modIndex).toBe(0);
    expect(u.fix).toEqual({ kind: 'add', name: 'Furikake', quantity: 5, unit: 'g' });
  });

  it('applies the picked ingredient on the next pass', () => {
    const mods = [{ type: 'substitute', target: 'Toast', newName: 'Sourdough boule' }];
    const [u] = apply(mods).unapplied;
    const fixed = apply(resolveModification(mods, u.modIndex, SWEET_POTATO, 200, 'g'));
    expect(fixed.unapplied).toEqual([]);
    expect(toastLine(fixed)).toMatchObject({ label_ingredient_id: 2, amount: '200', unit: 'g' });
  });

  it('leaves other modifications untouched when one is resolved', () => {
    const mods = [
      { type: 'set_amount', target: 'Toast', quantity: 45, unit: 'g' },
      { type: 'add', newName: 'Furikake', quantity: 5, unit: 'g' },
    ];
    const next = resolveModification(mods, 1, SWEET_POTATO, 100, 'g');
    expect(next[0]).toEqual(mods[0]);
    expect(next[1]).toMatchObject({ type: 'add', newName: 'Sweet Potato, raw', quantity: 100 });
  });

  it('offers no fix for a target that is in neither the lines nor the notes', () => {
    expect(apply([{ type: 'remove', target: 'Bacon' }]).unapplied[0].fix).toBeUndefined();
  });
});

describe('applyModifications — amounts, removals, scale', () => {
  it('sets a line amount', () => {
    const r = apply([{ type: 'set_amount', target: 'Toast', quantity: 45, unit: 'g' }]);
    expect(toastLine(r)).toMatchObject({ label_ingredient_id: 1, amount: '45', unit: 'g' });
  });

  it('treats a zero amount as a removal', () => {
    const r = apply([{ type: 'set_amount', target: 'Toast', quantity: 0 }]);
    expect(toastLine(r).amount).toBe('0');
    expect(resolvedReviewRows(RECIPE, byId, r.resolvedLines).map(x => x.name)).toEqual(['Everything seasoning']);
  });

  it('reads the scale factor from quantity when the model misplaces it', () => {
    expect(apply([{ type: 'scale', quantity: 0.5 }]).servingsScale).toBe(0.5);
  });
});

describe('mergeRecipeModifications', () => {
  it('appends a partial follow-up onto prior swaps instead of replacing them', () => {
    const prev = [{ type: 'substitute', target: 'Toast', newName: 'sweet potato', quantity: 200, unit: 'g' }];
    const next = [{ type: 'add', newName: 'BBQ sauce', quantity: 30, unit: 'g', calories: 20 }];
    expect(mergeRecipeModifications(prev, next)).toEqual([...prev, ...next]);
  });

  it('keeps the baseline when the follow-up list is empty', () => {
    const prev = [{ type: 'set_amount', target: 'Toast', quantity: 45, unit: 'g' }];
    expect(mergeRecipeModifications(prev, [])).toEqual(prev);
  });
});
