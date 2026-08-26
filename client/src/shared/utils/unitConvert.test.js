import { describe, it, expect } from 'vitest';
import {
  canonicalUnit,
  unitFamily,
  sameUnit,
  basisUnitFor,
  amountInBasisUnit,
  basisAmountToUnit,
  convertForIngredient,
  loggableUnitsFor,
  hasUnitChoice,
  roundAmount,
} from './unitConvert';

// Nonfat milk saved as "1 cup", with 1 cup weighed at 245 g.
const milk = { tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: 245 };
// The same milk saved without ever filling in the gram equivalent.
const milkNoBridge = { tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: null };
// Salmon saved as "1 filet", one filet weighing 170 g.
const salmon = { tracking_type: 'unit', unit_name: 'filet', serving_quantity: 1, grams_per_unit: 170 };
// Salmon saved per 100 g.
const salmonByWeight = { tracking_type: 'weight', grams_per_serving: 100 };
// Protein powder saved as "1 scoop" with no weight recorded.
const scoop = { tracking_type: 'unit', unit_name: 'scoop', serving_quantity: 1, grams_per_unit: null };

const near = (a, b, digits = 4) => expect(a).toBeCloseTo(b, digits);

describe('canonicalUnit', () => {
  it('normalizes spelling, case, and punctuation', () => {
    expect(canonicalUnit('Grams')).toBe('g');
    expect(canonicalUnit(' OZ ')).toBe('oz');
    expect(canonicalUnit('Tablespoons')).toBe('tbsp');
    expect(canonicalUnit('fl. oz.')).toBe('fl oz');
    expect(canonicalUnit('fluid ounces')).toBe('fl oz');
    expect(canonicalUnit('Cups')).toBe('cup');
  });

  it('folds plurals on count units so "filets" is "filet"', () => {
    expect(canonicalUnit('filets')).toBe('filet');
    expect(canonicalUnit('Filet')).toBe('filet');
    expect(canonicalUnit('slices')).toBe('slice');
  });

  it('is empty for a missing unit', () => {
    expect(canonicalUnit('')).toBe('');
    expect(canonicalUnit(null)).toBe('');
  });
});

describe('unitFamily', () => {
  it('separates oz (mass) from fl oz (volume)', () => {
    expect(unitFamily('oz')).toBe('mass');
    expect(unitFamily('fl oz')).toBe('volume');
  });

  it('treats anything unrecognized as a count', () => {
    expect(unitFamily('filet')).toBe('count');
    expect(unitFamily('bagel')).toBe('count');
    expect(unitFamily('serving')).toBe('count');
  });
});

describe('sameUnit', () => {
  it('matches across spelling differences', () => {
    expect(sameUnit('Filets', 'filet')).toBe(true);
    expect(sameUnit('ounces', 'oz')).toBe(true);
  });

  it('does not match different count units', () => {
    expect(sameUnit('cup', 'slice')).toBe(false);
    expect(sameUnit('oz', 'fl oz')).toBe(false);
  });
});

describe('basisUnitFor', () => {
  it('reads a unit-tracked ingredient', () => {
    expect(basisUnitFor(milk)).toEqual({ unit: 'cup', family: 'volume', gramsPerUnit: 245 });
    expect(basisUnitFor(salmon)).toEqual({ unit: 'filet', family: 'count', gramsPerUnit: 170 });
  });

  it('treats a weight-tracked ingredient as grams', () => {
    expect(basisUnitFor(salmonByWeight)).toEqual({ unit: 'g', family: 'mass', gramsPerUnit: 1 });
  });

  it('drops a zero or missing gram equivalent', () => {
    expect(basisUnitFor(scoop).gramsPerUnit).toBeNull();
    expect(basisUnitFor({ ...scoop, grams_per_unit: 0 }).gramsPerUnit).toBeNull();
  });
});

describe('amountInBasisUnit — the cup-of-milk case', () => {
  it('converts volume to volume with no gram equivalent needed', () => {
    near(amountInBasisUnit(milkNoBridge, 200, 'ml'), 200 / 236.5882365);
    near(amountInBasisUnit(milkNoBridge, 8, 'fl oz'), (8 * 29.5735295625) / 236.5882365);
    near(amountInBasisUnit(milkNoBridge, 2, 'tbsp'), (2 * 14.78676478125) / 236.5882365);
  });

  it('converts mass to cups through the gram equivalent', () => {
    near(amountInBasisUnit(milk, 245, 'g'), 1);
    near(amountInBasisUnit(milk, 7, 'oz'), (7 * 28.349523125) / 245);
  });

  it('refuses mass when no gram equivalent was recorded', () => {
    expect(amountInBasisUnit(milkNoBridge, 245, 'g')).toBeNull();
  });

  it('passes the ingredient own unit through untouched', () => {
    expect(amountInBasisUnit(milk, 1.5, 'cup')).toBe(1.5);
    expect(amountInBasisUnit(milk, 1.5, 'Cups')).toBe(1.5);
  });
});

describe('amountInBasisUnit — the salmon filet case', () => {
  it('converts grams to filets when one filet weight is known', () => {
    near(amountInBasisUnit(salmon, 340, 'g'), 2);
    near(amountInBasisUnit(salmon, 6, 'oz'), (6 * 28.349523125) / 170);
  });

  it('counts filets directly', () => {
    expect(amountInBasisUnit(salmon, 1, 'filet')).toBe(1);
    expect(amountInBasisUnit(salmon, 2, 'filets')).toBe(2);
  });

  it('never scales one count unit onto a differently-named one', () => {
    // The silent mis-scale this module exists to prevent: 2 slices must not
    // quietly become 2 filets.
    expect(amountInBasisUnit(salmon, 2, 'slice')).toBeNull();
    expect(amountInBasisUnit(salmon, 2, 'cup')).toBeNull();
    expect(amountInBasisUnit(scoop, 2, 'tbsp')).toBeNull();
  });

  it('refuses a volume against a count basis even with a weight bridge', () => {
    // Knowing a filet weighs 170 g says nothing about the space it occupies.
    expect(amountInBasisUnit(salmon, 100, 'ml')).toBeNull();
  });
});

describe('amountInBasisUnit — grams-per-serving ingredients', () => {
  it('accepts mass units', () => {
    expect(amountInBasisUnit(salmonByWeight, 150, 'g')).toBe(150);
    near(amountInBasisUnit(salmonByWeight, 6, 'oz'), 6 * 28.349523125);
  });

  it('refuses volumes, because no density is knowable', () => {
    expect(amountInBasisUnit(salmonByWeight, 200, 'ml')).toBeNull();
    expect(amountInBasisUnit(salmonByWeight, 1, 'cup')).toBeNull();
  });

  it('refuses counts', () => {
    expect(amountInBasisUnit(salmonByWeight, 1, 'filet')).toBeNull();
  });
});

describe('amountInBasisUnit — bad input', () => {
  it('rejects negatives, blanks, and nonsense', () => {
    expect(amountInBasisUnit(milk, -1, 'ml')).toBeNull();
    expect(amountInBasisUnit(milk, '', 'ml')).toBeNull();
    expect(amountInBasisUnit(milk, 'abc', 'ml')).toBeNull();
    expect(amountInBasisUnit(null, 100, 'ml')).toBeNull();
  });

  it('allows zero', () => {
    expect(amountInBasisUnit(milk, 0, 'cup')).toBe(0);
  });

  it('reads a missing unit as the ingredient own unit', () => {
    // The old scaling functions defaulted a bare number to grams for a
    // weight-tracked item and to a count for a unit-tracked one; both callers
    // still rely on that.
    expect(amountInBasisUnit(milk, 2)).toBe(2);
    expect(amountInBasisUnit(salmon, 3, '')).toBe(3);
    expect(amountInBasisUnit(salmonByWeight, 150, null)).toBe(150);
  });
});

describe('basisAmountToUnit', () => {
  it('is the inverse of amountInBasisUnit', () => {
    for (const unit of ['ml', 'fl oz', 'tbsp', 'g', 'oz']) {
      const inBasis = amountInBasisUnit(milk, 3, unit);
      near(basisAmountToUnit(milk, inBasis, unit), 3);
    }
    for (const unit of ['filet', 'g', 'oz']) {
      const inBasis = amountInBasisUnit(salmon, 2, unit);
      near(basisAmountToUnit(salmon, inBasis, unit), 2);
    }
  });

  it('states one cup in the other units', () => {
    near(basisAmountToUnit(milk, 1, 'ml'), 236.5882365);
    near(basisAmountToUnit(milk, 1, 'g'), 245);
    near(basisAmountToUnit(milk, 1, 'fl oz'), 8);
  });

  it('refuses unreachable units', () => {
    expect(basisAmountToUnit(milkNoBridge, 1, 'g')).toBeNull();
    expect(basisAmountToUnit(salmon, 1, 'ml')).toBeNull();
  });
});

describe('convertForIngredient', () => {
  it('restates an amount between two non-basis units', () => {
    near(convertForIngredient(milk, 200, 'ml', 'fl oz'), 200 / 29.5735295625);
    near(convertForIngredient(milk, 245, 'g', 'ml'), 236.5882365);
    near(convertForIngredient(salmon, 340, 'g', 'filet'), 2);
  });

  it('short-circuits identical units', () => {
    expect(convertForIngredient(salmon, 2, 'filets', 'filet')).toBe(2);
  });

  it('returns null when either half is unreachable', () => {
    expect(convertForIngredient(salmon, 1, 'filet', 'ml')).toBeNull();
    expect(convertForIngredient(milkNoBridge, 1, 'cup', 'g')).toBeNull();
  });
});

describe('loggableUnitsFor', () => {
  it('offers volume plus mass for a cup-based ingredient with a weight', () => {
    expect(loggableUnitsFor(milk)).toEqual(['cup', 'ml', 'fl oz', 'tbsp', 'tsp', 'g', 'oz']);
  });

  it('drops the mass options when no gram equivalent was recorded', () => {
    expect(loggableUnitsFor(milkNoBridge)).toEqual(['cup', 'ml', 'fl oz', 'tbsp', 'tsp']);
  });

  it('offers grams alongside a count unit that has a known weight', () => {
    expect(loggableUnitsFor(salmon)).toEqual(['filet', 'g', 'oz']);
  });

  it('leaves a bridgeless count unit alone', () => {
    expect(loggableUnitsFor(scoop)).toEqual(['scoop']);
  });

  it('offers only mass for a grams-per-serving ingredient', () => {
    expect(loggableUnitsFor(salmonByWeight)).toEqual(['g', 'oz']);
  });

  it('lists no unit twice when the basis is already a loggable one', () => {
    const perMl = { tracking_type: 'unit', unit_name: 'ml', serving_quantity: 100, grams_per_unit: null };
    expect(loggableUnitsFor(perMl)).toEqual(['ml', 'fl oz', 'cup', 'tbsp', 'tsp']);
  });

  it('only ever offers units that actually resolve', () => {
    for (const ing of [milk, milkNoBridge, salmon, salmonByWeight, scoop]) {
      for (const unit of loggableUnitsFor(ing)) {
        expect(amountInBasisUnit(ing, 1, unit)).not.toBeNull();
      }
    }
  });
});

describe('hasUnitChoice', () => {
  it('is false only when the ingredient is locked to one unit', () => {
    expect(hasUnitChoice(scoop)).toBe(false);
    expect(hasUnitChoice(milk)).toBe(true);
    expect(hasUnitChoice(salmon)).toBe(true);
    expect(hasUnitChoice(salmonByWeight)).toBe(true);
  });
});

describe('roundAmount', () => {
  it('rounds to something a human would type', () => {
    expect(roundAmount(236.5882365)).toBe(236.59);
    expect(roundAmount(0.845350105)).toBe(0.85);
    expect(roundAmount(2)).toBe(2);
  });

  it('is null for nonsense', () => {
    expect(roundAmount('')).toBeNull();
    expect(roundAmount('abc')).toBeNull();
  });
});

describe('ingredients saved without a unit name', () => {
  // Regression: basisUnitFor fell back to 'serving' while
  // defaultAmountForIngredient sent 'unit', so the converter saw two different
  // count units, refused, and the ingredient could not be logged at all — with
  // a "needs grams per serving" message that pointed at the wrong thing.
  const nameless = { tracking_type: 'unit', unit_name: null, serving_quantity: 1 };

  it('falls back to the same unit every other caller uses', () => {
    expect(basisUnitFor(nameless).unit).toBe('unit');
    expect(basisUnitFor({ ...nameless, unit_name: '' }).unit).toBe('unit');
  });

  it('logs against the placeholder unit', () => {
    expect(amountInBasisUnit(nameless, 2, 'unit')).toBe(2);
    expect(basisAmountToUnit(nameless, 2, 'unit')).toBe(2);
  });

  it('treats the vague placeholders as the same thing', () => {
    expect(amountInBasisUnit(nameless, 2, 'serving')).toBe(2);
    expect(amountInBasisUnit(nameless, 2, 'servings')).toBe(2);
    expect(amountInBasisUnit({ tracking_type: 'unit', unit_name: 'serving' }, 2, 'unit')).toBe(2);
  });

  it('never lets a placeholder absorb a REAL unit', () => {
    // 1 serving of this spray is 10 sprays — reading "1 serving" as 1 spray
    // would be a 10x error, so it must be refused instead.
    const spray = { tracking_type: 'unit', unit_name: 'spray', serving_quantity: 10 };
    expect(amountInBasisUnit(spray, 1, 'serving')).toBeNull();
    expect(amountInBasisUnit(salmon, 1, 'serving')).toBeNull();
  });

  it('is loggable at all', () => {
    expect(loggableUnitsFor(nameless)).toEqual(['unit']);
  });
});
