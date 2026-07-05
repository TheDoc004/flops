import { describe, it, expect } from 'vitest';
import { resolveIngredientSource, enrichEstimate } from './ingredientSource';

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
