const fs = require('fs');
const path = require('path');
const {
  canonicalUnit,
  unitFamily,
  sameUnit,
  basisUnitFor,
  amountInBasisUnit,
  basisAmountToUnit,
  convertForIngredient,
  loggableUnitsFor,
} = require('../unitConvert');

// Nonfat milk saved as "1 cup", with 1 cup weighed at 245 g.
const milk = { tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: 245 };
const milkNoBridge = { tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: null };
const salmon = { tracking_type: 'unit', unit_name: 'filet', serving_quantity: 1, grams_per_unit: 170 };
const salmonByWeight = { tracking_type: 'weight', grams_per_serving: 100 };
const scoop = { tracking_type: 'unit', unit_name: 'scoop', serving_quantity: 1, grams_per_unit: null };

describe('canonicalUnit / unitFamily', () => {
  it('keeps oz (mass) and fl oz (volume) apart', () => {
    expect(canonicalUnit('fl. oz.')).toBe('fl oz');
    expect(unitFamily('oz')).toBe('mass');
    expect(unitFamily('fl oz')).toBe('volume');
  });

  it('folds plurals on count units', () => {
    expect(canonicalUnit('filets')).toBe('filet');
    expect(sameUnit('Filets', 'filet')).toBe(true);
    expect(sameUnit('cup', 'slice')).toBe(false);
  });
});

describe('basisUnitFor', () => {
  it('reads unit- and weight-tracked rows', () => {
    expect(basisUnitFor(milk)).toEqual({
      unit: 'cup', family: 'volume', gramsPerUnit: 245, gramsPerMl: 245 / 236.5882365,
    });
    expect(basisUnitFor(salmonByWeight)).toEqual({ unit: 'g', family: 'mass', gramsPerUnit: 1, gramsPerMl: null });
    expect(basisUnitFor(scoop).gramsPerUnit).toBeNull();
  });
});

describe('amountInBasisUnit', () => {
  it('converts volume to the cup basis without a gram equivalent', () => {
    expect(amountInBasisUnit(milkNoBridge, 200, 'ml')).toBeCloseTo(200 / 236.5882365, 6);
    expect(amountInBasisUnit(milkNoBridge, 8, 'fl oz')).toBeCloseTo(1, 6);
  });

  it('converts mass to cups through the gram equivalent', () => {
    expect(amountInBasisUnit(milk, 245, 'g')).toBeCloseTo(1, 6);
    expect(amountInBasisUnit(milk, 7, 'oz')).toBeCloseTo((7 * 28.349523125) / 245, 6);
  });

  it('converts grams to filets', () => {
    expect(amountInBasisUnit(salmon, 340, 'g')).toBeCloseTo(2, 6);
    expect(amountInBasisUnit(salmon, 2, 'filets')).toBe(2);
  });

  it('refuses every unknowable conversion instead of guessing', () => {
    expect(amountInBasisUnit(milkNoBridge, 245, 'g')).toBeNull();     // no bridge
    expect(amountInBasisUnit(salmon, 2, 'slice')).toBeNull();          // foreign count unit
    expect(amountInBasisUnit(salmon, 100, 'ml')).toBeNull();           // no volume for a count
    expect(amountInBasisUnit(salmonByWeight, 200, 'ml')).toBeNull();   // no density
    expect(amountInBasisUnit(salmonByWeight, 1, 'filet')).toBeNull();
    expect(amountInBasisUnit(scoop, 2, 'tbsp')).toBeNull();
  });

  it('reads a missing unit as the ingredient own unit', () => {
    expect(amountInBasisUnit(milk, 2)).toBe(2);
    expect(amountInBasisUnit(salmon, 3, '')).toBe(3);
    expect(amountInBasisUnit(salmonByWeight, 150, null)).toBe(150);
  });

  it('rejects negatives and nonsense but allows zero', () => {
    expect(amountInBasisUnit(milk, -1, 'ml')).toBeNull();
    expect(amountInBasisUnit(milk, 'abc', 'ml')).toBeNull();
    expect(amountInBasisUnit(milk, 0, 'cup')).toBe(0);
  });
});

describe('basisAmountToUnit / convertForIngredient', () => {
  it('round-trips every loggable unit', () => {
    for (const ing of [milk, milkNoBridge, salmon, salmonByWeight, scoop]) {
      for (const unit of loggableUnitsFor(ing)) {
        const inBasis = amountInBasisUnit(ing, 3, unit);
        expect(inBasis).not.toBeNull();
        expect(basisAmountToUnit(ing, inBasis, unit)).toBeCloseTo(3, 6);
      }
    }
  });

  it('restates an amount between two non-basis units', () => {
    expect(convertForIngredient(milk, 245, 'g', 'ml')).toBeCloseTo(236.5882365, 4);
    expect(convertForIngredient(salmon, 340, 'g', 'filet')).toBeCloseTo(2, 6);
    expect(convertForIngredient(salmon, 1, 'filet', 'ml')).toBeNull();
  });
});

describe('loggableUnitsFor', () => {
  it('offers exactly the units that resolve', () => {
    expect(loggableUnitsFor(milk)).toEqual(['cup', 'ml', 'fl oz', 'tbsp', 'tsp', 'g', 'oz']);
    expect(loggableUnitsFor(milkNoBridge)).toEqual(['cup', 'ml', 'fl oz', 'tbsp', 'tsp']);
    expect(loggableUnitsFor(salmon)).toEqual(['filet', 'g', 'oz']);
    expect(loggableUnitsFor(scoop)).toEqual(['scoop']);
    expect(loggableUnitsFor(salmonByWeight)).toEqual(['g', 'oz']);
  });
});

describe('ingredients saved without a unit name', () => {
  // Regression: two different fallbacks ('unit' vs 'serving') made these
  // ingredients impossible to log.
  const nameless = { tracking_type: 'unit', unit_name: null, serving_quantity: 1 };

  it('falls back to the unit name the rest of the app uses', () => {
    expect(basisUnitFor(nameless).unit).toBe('unit');
    expect(amountInBasisUnit(nameless, 2, 'unit')).toBe(2);
    expect(amountInBasisUnit(nameless, 2, 'serving')).toBe(2);
    expect(loggableUnitsFor(nameless)).toEqual(['unit']);
  });

  it('never lets a placeholder absorb a real unit', () => {
    const spray = { tracking_type: 'unit', unit_name: 'spray', serving_quantity: 10 };
    expect(amountInBasisUnit(spray, 1, 'serving')).toBeNull();
  });
});

// The client and server copies must not drift: the log-time picker offers units
// the server then has to accept, so a rule that lives on only one side is a bug.
describe('density (grams_per_ml)', () => {
  // Greek yogurt saved per 170 g serving, with a measured density.
  const yogurt = { tracking_type: 'weight', grams_per_serving: 170, grams_per_ml: 1.05 };
  // Soy sauce saved per 15 ml, density only — no grams_per_unit.
  const soy = { tracking_type: 'unit', unit_name: 'ml', serving_quantity: 15, grams_per_ml: 1.2 };
  // Protein powder: 31 g per scoop, ~0.42 g/ml.
  const powder = { tracking_type: 'unit', unit_name: 'scoop', serving_quantity: 1, grams_per_unit: 31, grams_per_ml: 0.42 };

  it('lets a weighed food take a volume', () => {
    expect(amountInBasisUnit(yogurt, 1, 'cup')).toBeCloseTo(236.5882365 * 1.05, 6);
    expect(basisAmountToUnit(yogurt, 248.42, 'cup')).toBeCloseTo(1, 3);
    expect(loggableUnitsFor(yogurt)).toEqual(['g', 'oz', 'ml', 'fl oz', 'cup', 'tbsp', 'tsp']);
  });

  it('still refuses volume on a weighed food without a density', () => {
    expect(amountInBasisUnit(salmonByWeight, 1, 'cup')).toBeNull();
    expect(loggableUnitsFor(salmonByWeight)).toEqual(['g', 'oz']);
  });

  it('gives a volume basis its grams without grams_per_unit', () => {
    expect(basisUnitFor(soy).gramsPerUnit).toBeCloseTo(1.2, 6);
    expect(amountInBasisUnit(soy, 50, 'g')).toBeCloseTo(50 / 1.2, 6);
    expect(convertForIngredient(soy, 1, 'tbsp', 'g')).toBeCloseTo(14.78676478125 * 1.2, 6);
    expect(loggableUnitsFor(soy)).toEqual(['ml', 'fl oz', 'cup', 'tbsp', 'tsp', 'g', 'oz']);
  });

  it('lets a counted food take a volume through grams', () => {
    expect(amountInBasisUnit(powder, 100, 'ml')).toBeCloseTo((100 * 0.42) / 31, 6);
    expect(loggableUnitsFor(powder)).toEqual(['scoop', 'g', 'oz', 'ml', 'fl oz', 'cup', 'tbsp', 'tsp']);
    // A count without a gram weight has nothing to route a volume through.
    expect(amountInBasisUnit({ ...powder, grams_per_unit: null }, 100, 'ml')).toBeNull();
  });

  it('ignores a zero or junk density', () => {
    expect(amountInBasisUnit({ ...yogurt, grams_per_ml: 0 }, 1, 'cup')).toBeNull();
    expect(amountInBasisUnit({ ...yogurt, grams_per_ml: 'abc' }, 1, 'cup')).toBeNull();
  });
});

describe('parity with the client ES-module twin', () => {
  const strip = src =>
    src
      .replace(/\/\*\*[\s\S]*?\*\//g, '')          // block comments (the header differs by design)
      .replace(/^export (function|const) /gm, '$1 ')
      .replace(/module\.exports = \{[\s\S]*?\};/, '')
      .replace(/\/\/.*$/gm, '')                     // line comments
      .replace(/\s+/g, ' ')
      .trim();

  it('has an identical implementation body', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'unitConvert.js'), 'utf8');
    const clientSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'client', 'src', 'shared', 'utils', 'unitConvert.js'),
      'utf8'
    );
    expect(strip(serverSrc)).toBe(strip(clientSrc));
  });
});
