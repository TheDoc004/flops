import { describe, it, expect } from 'vitest';
import {
  resolveIngredientSource, enrichEstimate, libraryForPrompt, libraryFromSavedName,
} from './ingredientSource';

// A weight-tracked saved ingredient: macros are per `grams_per_serving` grams.
const lib = (name, calories, opts = {}) => ({
  id: opts.id ?? 1,
  name,
  tracking_type: 'weight',
  grams_per_serving: opts.grams_per_serving ?? 100,
  calories,
  protein_g: opts.protein_g ?? 0,
  carbs_g: opts.carbs_g ?? 0,
  fat_g: opts.fat_g ?? 0,
  use_count: opts.use_count ?? 0,
});

// An AI ingredient row as it arrives from the server (already scaled to amount).
const row = (over = {}) => ({
  name: 'chicken breast',
  quantity: 163,
  unit: 'g',
  state: 'cooked',
  calories: 269,
  protein: 50.5,
  carbs: 0,
  fat: 5.9,
  macroSource: 'estimated',
  ...over,
});

describe('resolveIngredientSource — macro source hierarchy', () => {
  it('1. explicit per-100g macros in the message are authoritative (source "provided")', () => {
    // User pasted "165 cal/100g cooked chicken" → server scaled to 163g = 269 cal.
    const ing = row({ macroSource: 'provided', calories: 269, protein: 50.5, fat: 5.9 });
    const library = [lib('Cooked chicken breast', 999, { protein_g: 99 })]; // would mislead if used
    const r = resolveIngredientSource(ing, library, []);
    expect(r.source).toBe('provided');
    expect(r.calories).toBe(269);
    expect(r.protein).toBe(50.5);
    expect(r.label_ingredient_id).toBeUndefined();
  });

  it('2. explicit per-serving macros in the message are honored', () => {
    // "150 cal per 45g dry rice" → 90g = 300 cal, provided.
    const ing = row({ name: 'jasmine rice', macroSource: 'provided', quantity: 90, calories: 300, carbs: 70, protein: 6, fat: 0 });
    const r = resolveIngredientSource(ing, [lib('Jasmine rice', 130)], []);
    expect(r.source).toBe('provided');
    expect(r.calories).toBe(300);
    expect(r.carbs).toBe(70);
  });

  it('3. whole-ingredient macros in the message are honored', () => {
    // "this BBQ sauce has 20 calories total".
    const ing = row({ name: 'BBQ sauce', macroSource: 'provided', quantity: 20, unit: 'g', calories: 20, carbs: 5, protein: 0, fat: 0 });
    const r = resolveIngredientSource(ing, [], []);
    expect(r.source).toBe('provided');
    expect(r.calories).toBe(20);
  });

  it('4. message macros beat a saved library match (conflict → message wins)', () => {
    const ing = row({ macroSource: 'provided', calories: 269 });
    // Strong-name library match with very different macros — must be ignored.
    const library = [lib('chicken breast', 800, { protein_g: 10, fat_g: 60 })];
    const r = resolveIngredientSource(ing, library, []);
    expect(r.source).toBe('provided');
    expect(r.calories).toBe(269);
    expect(r.label_ingredient_id).toBeUndefined();
  });

  it('4b. provided macros that identically match a saved ingredient reuse it (dedupe)', () => {
    // "chicken breast, 165 cal / 31p / 0c / 3.6f per 100g" and the user already
    // has exactly that saved → link the saved item so recipe-save reuses its id.
    const ing = row({ name: 'chicken breast', macroSource: 'provided', quantity: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 });
    const library = [lib('Chicken breast', 165, { id: 20, protein_g: 31, carbs_g: 0, fat_g: 3.6 })];
    const r = resolveIngredientSource(ing, library, []);
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(20);
    expect(r.calories).toBe(165);
  });

  it('4c. provided macros within rounding of a saved ingredient still reuse it', () => {
    // User typed whole numbers; the saved item has precise decimals.
    const ing = row({ name: 'oats', macroSource: 'provided', quantity: 50, unit: 'g', calories: 195, protein: 6.5, carbs: 33, fat: 3.5 });
    const library = [lib('Oats', 389.2, { id: 21, protein_g: 13.1, carbs_g: 66.3, fat_g: 6.9, grams_per_serving: 100 })];
    const r = resolveIngredientSource(ing, library, []);
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(21);
  });

  it('5. no macros in the message → falls back to the ingredient library', () => {
    const ing = row({ name: 'carrots', macroSource: 'estimated', quantity: 100, unit: 'g', calories: 999 });
    const library = [lib('Carrots', 41, { id: 7, protein_g: 0.9, carbs_g: 9.6, fat_g: 0.2 })];
    const r = resolveIngredientSource(ing, library, []);
    expect(r.source).toBe('library');
    expect(r.calories).toBe(41); // 100g of a per-100g saved item
    expect(r.label_ingredient_id).toBe(7);
  });

  it('6. no macros and no library match → generic estimate (source "ai")', () => {
    const ing = row({ name: 'dragonfruit salsa', macroSource: 'estimated', calories: 88 });
    const r = resolveIngredientSource(ing, [], []); // empty library + empty common foods
    expect(r.source).toBe('ai');
    expect(r.calories).toBe(88);
  });
});

describe('resolveIngredientSource — state-modifier mismatch must not auto-match', () => {
  it('generic "banana" does NOT auto-match saved "Frozen banana"', () => {
    const ing = row({ name: 'banana', macroSource: 'estimated', quantity: 118, unit: 'g', calories: 105 });
    const r = resolveIngredientSource(ing, [lib('Frozen banana', 90, { id: 4 })], []);
    expect(r.source).toBe('ai'); // falls through, keeps the generic estimate
    expect(r.calories).toBe(105);
  });

  it('generic "strawberries" does NOT auto-match saved "Frozen strawberries"', () => {
    const ing = row({ name: 'strawberries', macroSource: 'estimated', quantity: 454, unit: 'g', calories: 145 });
    const r = resolveIngredientSource(ing, [lib('Frozen strawberries', 35, { id: 5 })], []);
    expect(r.source).toBe('ai');
    expect(r.calories).toBe(145);
  });

  it('saying "frozen banana" explicitly still matches saved "Frozen banana"', () => {
    const ing = row({ name: 'frozen banana', macroSource: 'estimated', quantity: 100, unit: 'g', calories: 999 });
    const r = resolveIngredientSource(ing, [lib('Frozen banana', 90, { id: 4 })], []);
    expect(r.source).toBe('library');
    expect(r.calories).toBe(90);
    expect(r.label_ingredient_id).toBe(4);
  });

  it('variety/brand subset matches keep working ("honey" → "Clover honey")', () => {
    const ing = row({ name: 'honey', macroSource: 'estimated', quantity: 21, unit: 'g', calories: 999 });
    const r = resolveIngredientSource(ing, [lib('Clover honey', 304, { id: 9 })], []);
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(9);
  });
});

describe('resolveIngredientSource — subset must cover the head noun', () => {
  it('"onions" does NOT auto-match saved "Onion bagels" (an onion is not a bagel)', () => {
    const ing = row({ name: 'onions', macroSource: 'estimated', quantity: 200, unit: 'g', calories: 80 });
    const r = resolveIngredientSource(ing, [lib('Onion bagels', 270, { id: 11 })], []);
    expect(r.source).toBe('ai');
    expect(r.calories).toBe(80);
  });

  it('"onion bagel" still auto-matches saved "Onion bagels"', () => {
    const ing = row({ name: 'onion bagel', macroSource: 'estimated', quantity: 100, unit: 'g', calories: 999 });
    const r = resolveIngredientSource(ing, [lib('Onion bagels', 270, { id: 11 })], []);
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(11);
  });

  it('brand-prefixed head matches keep working ("chicken breast" → "Kirkland chicken breast")', () => {
    const ing = row({ name: 'chicken breast', macroSource: 'estimated', quantity: 100, unit: 'g', calories: 999 });
    const r = resolveIngredientSource(ing, [lib('Kirkland chicken breast', 165, { id: 12 })], []);
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(12);
  });
});

describe('enrichEstimate — wires the resolver across a whole estimate', () => {
  it('locks provided rows and library-matches the rest', () => {
    const est = {
      ingredients: [
        row({ name: 'chicken breast', macroSource: 'provided', calories: 269 }),
        row({ name: 'carrots', macroSource: 'estimated', quantity: 100, unit: 'g', calories: 999 }),
      ],
    };
    const library = [
      lib('chicken breast', 800, { id: 3 }),            // must NOT win (row is provided)
      lib('Carrots', 41, { id: 7, carbs_g: 9.6 }),       // wins for the estimated row
    ];
    const out = enrichEstimate(est, library, []);
    expect(out.ingredients[0].source).toBe('provided');
    expect(out.ingredients[0].calories).toBe(269);
    expect(out.ingredients[1].source).toBe('library');
    expect(out.ingredients[1].calories).toBe(41);
  });
});

// The salmon case: a saved ingredient measured in a unit the AI would otherwise
// normalize away.
const salmon = {
  id: 90, name: 'Salmon', tracking_type: 'unit', unit_name: 'filet',
  serving_quantity: 1, grams_per_unit: 170,
  calories: 350, protein_g: 34, carbs_g: 0, fat_g: 22, use_count: 5,
};
const milk = {
  id: 91, name: 'Nonfat milk', tracking_type: 'unit', unit_name: 'cup',
  serving_quantity: 1, grams_per_unit: 245,
  calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5, use_count: 9,
};
const scoop = {
  id: 92, name: 'Whey', tracking_type: 'unit', unit_name: 'scoop',
  serving_quantity: 1, calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5, use_count: 1,
};

describe('libraryForPrompt', () => {
  it('gives each ingredient a name, its unit, and what one weighs', () => {
    expect(libraryForPrompt([salmon])).toEqual([
      { name: 'Salmon', unit: 'filet', gramsPerUnit: 170 },
    ]);
  });

  it('omits a weight it does not have', () => {
    expect(libraryForPrompt([scoop])).toEqual([{ name: 'Whey', unit: 'scoop' }]);
  });

  it('describes a grams-per-serving ingredient in grams, with no redundant weight', () => {
    expect(libraryForPrompt([lib('Oats', 150)])).toEqual([{ name: 'Oats', unit: 'g' }]);
  });

  it('puts the most-used first so a truncated list keeps the best entries', () => {
    const names = libraryForPrompt([scoop, milk, salmon]).map(x => x.name);
    expect(names).toEqual(['Nonfat milk', 'Salmon', 'Whey']);
  });

  it('honours the cap and skips nameless rows', () => {
    expect(libraryForPrompt([salmon, milk, scoop], 2)).toHaveLength(2);
    expect(libraryForPrompt([{ id: 1, name: '  ' }, salmon])).toHaveLength(1);
  });
});

describe('libraryFromSavedName', () => {
  it('resolves the exact name the model returned', () => {
    expect(libraryFromSavedName('Salmon', [salmon, milk])).toBe(salmon);
    expect(libraryFromSavedName('  salmon ', [salmon, milk])).toBe(salmon);
  });

  it('ignores a name that is not really in the library', () => {
    // The model must not be able to invent a match.
    expect(libraryFromSavedName('Salmon fillet', [salmon])).toBeNull();
    expect(libraryFromSavedName('', [salmon])).toBeNull();
    expect(libraryFromSavedName(null, [salmon])).toBeNull();
  });
});

describe('resolveIngredientSource — the saved ingredient the model named', () => {
  it('uses the saved macros for "1 filet of salmon"', () => {
    const r = resolveIngredientSource(
      row({ name: 'salmon', quantity: 1, unit: 'filet', calories: 210, protein: 20, carbs: 0, fat: 13, savedIngredient: 'Salmon' }),
      [salmon]
    );
    expect(r.source).toBe('library');
    expect(r.label_ingredient_id).toBe(90);
    expect(r.calories).toBe(350); // the user's own number, not the estimate's 210
  });

  it('converts when the user said a different unit', () => {
    const r = resolveIngredientSource(
      row({ name: 'salmon', quantity: 340, unit: 'g', savedIngredient: 'Salmon' }),
      [salmon]
    );
    expect(r.source).toBe('library');
    expect(r.calories).toBe(700);
  });

  it('beats a fuzzy name match on a different ingredient', () => {
    const wrong = { ...lib('Salmon patty', 180, { id: 93 }), use_count: 99 };
    const r = resolveIngredientSource(
      row({ name: 'salmon', quantity: 1, unit: 'filet', savedIngredient: 'Salmon' }),
      [wrong, salmon]
    );
    expect(r.label_ingredient_id).toBe(90);
  });

  it('ignores a name the library does not have', () => {
    const r = resolveIngredientSource(
      row({ name: 'sablefish', quantity: 1, unit: 'filet', calories: 210, savedIngredient: 'Black cod' }),
      [salmon]
    );
    expect(r.source).toBe('ai');
    expect(r.calories).toBe(210);
  });

  it('falls back to the estimate when the unit cannot be converted', () => {
    // "2 slices" of a per-filet item: refused rather than read as 2 filets.
    const r = resolveIngredientSource(
      row({ name: 'salmon', quantity: 2, unit: 'slice', calories: 210, savedIngredient: 'Salmon' }),
      [salmon]
    );
    expect(r.source).toBe('ai');
    expect(r.calories).toBe(210);
  });

  it('still lets explicit user-provided macros win', () => {
    const r = resolveIngredientSource(
      row({ name: 'salmon', quantity: 1, unit: 'filet', calories: 400, macroSource: 'provided', savedIngredient: 'Salmon' }),
      [salmon]
    );
    expect(r.source).toBe('provided');
    expect(r.calories).toBe(400);
  });
});
