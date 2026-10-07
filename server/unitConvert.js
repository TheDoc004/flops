/**
 * Unit conversion for logging a saved ingredient in a unit other than the one
 * it was saved in — "1 cup nonfat milk" logged as 200 ml, 7 fl oz, or 245 g.
 *
 * Every unit belongs to one of three FAMILIES:
 *
 *   mass    g, kg, mg, oz, lb            — exact factors between them
 *   volume  ml, l, tsp, tbsp, fl oz,     — exact factors between them
 *           cup, pint, quart
 *   count   egg, slice, scoop, filet,    — a countable thing; no factor to
 *           serving, piece, <custom>       anything but itself
 *
 * Within a family conversion is free. ACROSS families it needs a bridge, and
 * there are two, both stored on `label_ingredients`:
 *
 *   grams_per_unit  the weight of ONE of the ingredient's own serving units
 *                   ("1 scoop = 31 g", "1 cup = 240 g")
 *   grams_per_ml    the ingredient's density ("soy sauce: 1.2 g per ml") —
 *                   the only thing that lets a weighed food take a volume
 *
 * Every crossing goes through grams, so what each basis can reach is:
 *
 *   mass   basis                  -> mass; + volume when grams_per_ml is set
 *   volume basis + grams_per_unit -> mass <-> volume, both ways
 *          (grams_per_ml alone works too: it implies grams_per_unit)
 *   count  basis + grams_per_unit -> mass <-> count; + volume with grams_per_ml
 *
 * Without a density a grams-per-serving item still can't take ml — nothing
 * about "100 g of yogurt" says how many cups that is.
 *
 * `oz` is always MASS (28.35 g) and `fl oz` is always VOLUME (29.57 ml). They
 * are offered as separate choices rather than one word meaning two things.
 *
 * Factors are exact US customary, matching the existing OZ_TO_G in
 * label-ocr/labelMacro.js rather than the FDA's rounded label values
 * (cup = 240 ml, tbsp = 15 ml). A cup is 236.588 ml here.
 *
 * Every function returns null rather than guessing when a conversion is not
 * knowable. Callers must treat null as "refuse to scale" — never as zero.
 *
 * NOTE: client/src/shared/utils/unitConvert.js is the ES-module twin of this
 * file — the same split `gramsFromAmount` already lives on both sides.
 * Change both together; unitConvertParity.test.js checks they agree.
 */

/** Grams per one unit of mass. */
const MASS_TO_G = {
  g: 1,
  mg: 0.001,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** Millilitres per one unit of volume. */
const VOLUME_TO_ML = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  'fl oz': 29.5735295625,
  cup: 236.5882365,
  pint: 473.176473,
  quart: 946.352946,
};

/** Spellings that mean a canonical unit ("ounces" -> "oz", "fluid ounce" -> "fl oz"). */
const ALIASES = {
  gram: 'g', grams: 'g', gm: 'g', gs: 'g',
  milligram: 'mg', milligrams: 'mg',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  ounce: 'oz', ounces: 'oz', ozs: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  'fl ounce': 'fl oz', 'fl ounces': 'fl oz',
  cups: 'cup',
  pints: 'pint', pt: 'pint',
  quarts: 'quart', qt: 'quart',
};

/**
 * A unit string reduced to its canonical form. Measurement units normalize
 * (case, punctuation, plurals); count units keep their own spelling, lowercased
 * and de-pluralized, because "filet" is only ever equal to "filet".
 */
function canonicalUnit(u) {
  const raw = String(u ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (MASS_TO_G[raw] != null || VOLUME_TO_ML[raw] != null) return raw;
  // "fl. oz." -> "fl oz", "tbsp." -> "tbsp"
  const bare = raw.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (MASS_TO_G[bare] != null || VOLUME_TO_ML[bare] != null) return bare;
  const alias = ALIASES[raw] || ALIASES[bare];
  if (alias) return alias;
  // Not a measurement unit: a countable thing. Fold the trailing plural so
  // "filets" and "filet" are the same unit.
  return bare.replace(/s$/, '') || bare;
}

/** 'mass' | 'volume' | 'count' — anything unrecognized is a countable thing. */
function unitFamily(u) {
  const c = canonicalUnit(u);
  if (!c) return 'count';
  if (MASS_TO_G[c] != null) return 'mass';
  if (VOLUME_TO_ML[c] != null) return 'volume';
  return 'count';
}

const isMassUnit = u => unitFamily(u) === 'mass';
const isVolumeUnit = u => unitFamily(u) === 'volume';
const isCountUnit = u => unitFamily(u) === 'count';

/** True when two unit strings name the same unit ("filets" === "Filet"). */
function sameUnit(a, b) {
  const ca = canonicalUnit(a);
  return !!ca && ca === canonicalUnit(b);
}

/**
 * Words that stand in for "one of these" without naming a real measurement.
 * An ingredient saved without a unit name gets one of these, and different
 * parts of the app historically picked different ones ('unit' from
 * defaultAmountForIngredient, 'serving' elsewhere), so they must be read as the
 * same thing or such an ingredient cannot be logged at all.
 */
const PLACEHOLDER_UNITS = new Set(['unit', 'serving', 'portion', 'each']);

/**
 * Whether a logged unit refers to the ingredient's own basis unit. True for an
 * exact match, and for two placeholders — but ONLY when the basis is itself a
 * placeholder. A real unit ("spray", "filet") never absorbs a vague "serving":
 * one serving may be ten sprays, and guessing there would be a 10x error.
 */
function matchesBasisUnit(unit, basisUnit) {
  if (unit === basisUnit) return true;
  return PLACEHOLDER_UNITS.has(unit) && PLACEHOLDER_UNITS.has(basisUnit);
}

/** Units offered in the log-time picker, in display order. */
const LOGGABLE_MASS_UNITS = ['g', 'oz'];
const LOGGABLE_VOLUME_UNITS = ['ml', 'fl oz', 'cup', 'tbsp', 'tsp'];

const num = v => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The measurement basis of a saved ingredient row:
 * `{ unit, family, gramsPerUnit, gramsPerMl }`, where gramsPerUnit is the
 * weight of ONE `unit` and gramsPerMl the density (each null when unknown).
 *
 * Weight-tracked rows store grams_per_serving (the mass of one serving) and are
 * measured in grams by definition. Unit-tracked rows store unit_name plus the
 * optional grams_per_unit. Any row may carry grams_per_ml. For a volume basis
 * the two bridges are the same fact, so either one supplies the other.
 */
function basisUnitFor(ing) {
  if (!ing) return null;
  const density = num(ing.grams_per_ml);
  let gramsPerMl = density != null && density > 0 ? density : null;
  if (ing.tracking_type === 'unit') {
    // 'unit' matches what defaultAmountForIngredient and the server's
    // displayUnitForIngredient fall back to for a nameless count.
    const unit = canonicalUnit(ing.unit_name) || 'unit';
    const family = unitFamily(unit);
    const gpu = num(ing.grams_per_unit);
    let gramsPerUnit = gpu != null && gpu > 0 ? gpu : null;
    if (family === 'volume') {
      if (gramsPerUnit == null && gramsPerMl != null) gramsPerUnit = gramsPerMl * VOLUME_TO_ML[unit];
      if (gramsPerMl == null && gramsPerUnit != null) gramsPerMl = gramsPerUnit / VOLUME_TO_ML[unit];
    }
    return { unit, family, gramsPerUnit, gramsPerMl };
  }
  return { unit: 'g', family: 'mass', gramsPerUnit: 1, gramsPerMl };
}

/** Grams in `v fromUnit`, or null when that unit has no route to a weight. */
function gramsIn(basis, v, fromUnit) {
  const family = unitFamily(fromUnit);
  if (family === 'mass') return v * MASS_TO_G[fromUnit];
  if (family === 'volume' && basis.gramsPerMl) return v * VOLUME_TO_ML[fromUnit] * basis.gramsPerMl;
  return null;
}

/** Grams in one of the ingredient's own serving units, or null when unknown. */
function gramsPerBasisUnit(basis) {
  if (basis.family === 'mass') return MASS_TO_G[basis.unit];
  return basis.gramsPerUnit;
}

/**
 * How many of the ingredient's OWN serving units `amount fromUnit` comes to —
 * the one primitive everything else is built on, because every existing scaling
 * formula already takes an amount in the ingredient's own unit.
 *
 * Returns null when the ingredient cannot be measured in `fromUnit`.
 */
function amountInBasisUnit(ing, amount, fromUnit) {
  const basis = basisUnitFor(ing);
  const v = num(amount);
  if (!basis || v == null || v < 0) return null;

  // No unit given at all means the ingredient's own unit — a bare number is
  // grams for a grams-per-serving item, and a count for a per-unit one.
  const from = canonicalUnit(fromUnit) || basis.unit;
  if (matchesBasisUnit(from, basis.unit)) return v;

  const ff = unitFamily(from);
  if (ff === basis.family) {
    if (ff === 'mass') return (v * MASS_TO_G[from]) / MASS_TO_G[basis.unit];
    if (ff === 'volume') return (v * VOLUME_TO_ML[from]) / VOLUME_TO_ML[basis.unit];
    return null; // two differently-named count units are not comparable
  }

  // Crossing families: through grams. A volume needs the density to get
  // there, and a foreign count unit tells us nothing at all.
  const grams = gramsIn(basis, v, from);
  const perUnit = gramsPerBasisUnit(basis);
  if (grams == null || !perUnit) return null;
  return grams / perUnit;
}

/**
 * The inverse: an amount already in the ingredient's own serving unit,
 * expressed in `toUnit`. Used to prefill the amount box when the user changes
 * the unit dropdown. Returns null when that unit isn't reachable.
 */
function basisAmountToUnit(ing, basisAmount, toUnit) {
  const basis = basisUnitFor(ing);
  const v = num(basisAmount);
  if (!basis || v == null || v < 0) return null;

  const to = canonicalUnit(toUnit);
  if (!to) return null;
  if (matchesBasisUnit(to, basis.unit)) return v;

  const tf = unitFamily(to);
  if (tf === basis.family) {
    if (tf === 'mass') return (v * MASS_TO_G[basis.unit]) / MASS_TO_G[to];
    if (tf === 'volume') return (v * VOLUME_TO_ML[basis.unit]) / VOLUME_TO_ML[to];
    return null;
  }

  const perUnit = gramsPerBasisUnit(basis);
  if (!perUnit) return null;
  const grams = v * perUnit;
  if (tf === 'mass') return grams / MASS_TO_G[to];
  if (tf === 'volume' && basis.gramsPerMl) return grams / basis.gramsPerMl / VOLUME_TO_ML[to];
  return null;
}

/**
 * Restate `amount fromUnit` in `toUnit` for one ingredient, routing through its
 * serving unit so the same bridge governs both halves. Null when either half is
 * unreachable.
 */
function convertForIngredient(ing, amount, fromUnit, toUnit) {
  if (sameUnit(fromUnit, toUnit)) return num(amount);
  const inBasis = amountInBasisUnit(ing, amount, fromUnit);
  if (inBasis == null) return null;
  return basisAmountToUnit(ing, inBasis, toUnit);
}

/**
 * Every unit this ingredient can actually be logged in, its own serving unit
 * first. Only units `amountInBasisUnit` can resolve appear — the picker never
 * offers a choice that would compute nothing.
 */
function loggableUnitsFor(ing) {
  const basis = basisUnitFor(ing);
  if (!basis) return [];
  const out = [];
  const push = u => {
    const c = canonicalUnit(u);
    if (c && !out.includes(c)) out.push(c);
  };

  // A grams-per-serving item takes volume only once it has a density.
  if (basis.family === 'mass') {
    LOGGABLE_MASS_UNITS.forEach(push);
    if (basis.gramsPerMl) LOGGABLE_VOLUME_UNITS.forEach(push);
    return out;
  }

  push(basis.unit);
  if (basis.family === 'volume') LOGGABLE_VOLUME_UNITS.forEach(push);
  if (basis.gramsPerUnit) LOGGABLE_MASS_UNITS.forEach(push);
  if (basis.family === 'count' && basis.gramsPerUnit && basis.gramsPerMl) {
    LOGGABLE_VOLUME_UNITS.forEach(push);
  }
  return out;
}

/** Whether a log row should show a unit dropdown at all. */
function hasUnitChoice(ing) {
  return loggableUnitsFor(ing).length > 1;
}

/** Round a converted amount to something a human would type. */
function roundAmount(n, places = 2) {
  const v = num(n);
  if (v == null) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

module.exports = {
  canonicalUnit,
  unitFamily,
  isMassUnit,
  isVolumeUnit,
  isCountUnit,
  sameUnit,
  LOGGABLE_MASS_UNITS,
  LOGGABLE_VOLUME_UNITS,
  basisUnitFor,
  amountInBasisUnit,
  basisAmountToUnit,
  convertForIngredient,
  loggableUnitsFor,
  hasUnitChoice,
  roundAmount,
};
