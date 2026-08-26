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
    expect(basisUnitFor(milk)).toEqual({ unit: 'cup', family: 'volume', gramsPerUnit: 245 });
    expect(basisUnitFor(salmonByWeight)).toEqual({ unit: 'g', family: 'mass', gramsPerUnit: 1 });
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
