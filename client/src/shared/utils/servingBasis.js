/**
 * Unified "serving basis" — bridges the simple amount + unit form to the
 * existing stored ingredient fields. tracking_type is DERIVED from the unit and
 * hidden from the UI, so the DB schema, API, scaling formulas, saved
 * ingredients, recipes, and logging are all unchanged:
 *
 *   g, oz                                  -> tracking_type 'weight'
 *                                            (grams_per_serving = amount in grams)
 *   ml, fl oz, cup, tbsp, tsp,             -> tracking_type 'unit'
 *   slice, egg, scoop, piece, serving,        (serving_quantity = amount,
 *   <custom>                                   unit_name = unit,
 *                                              grams_per_unit = optional gram equivalent)
 *
 * The macro-scaling formulas already branch on tracking_type, so weight units
 * scale by grams and everything else scales by count — no formula changes.
 */
import { loggableUnitsFor } from './unitConvert';

const OZ_TO_G = 28.349523125;

// Dropdown order (label-style units, weight first).
export const SERVING_UNITS = ['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'slice', 'egg', 'scoop', 'piece', 'serving'];

export function isWeightUnit(u) {
  const s = String(u || '').toLowerCase();
  return s === 'g' || s === 'oz';
}

/** Form serving fields -> stored fields (sent to the label-ingredient API). */
export function servingToStored({ serving_amount, serving_unit, serving_unit_custom, gram_equivalent }) {
  const rawAmt = serving_amount === '' || serving_amount == null ? null : Number(serving_amount);
  const amtValid = Number.isFinite(rawAmt) && rawAmt > 0;
  const amt = amtValid ? rawAmt : 1;
  const unit = serving_unit === 'custom'
    ? (String(serving_unit_custom || '').trim() || 'serving')
    : serving_unit;
  const serving_size_text = `${+Number(amt).toFixed(4)} ${unit}`.trim();

  if (isWeightUnit(serving_unit)) {
    const grams = !amtValid ? null : (serving_unit === 'oz' ? amt * OZ_TO_G : amt);
    return {
      tracking_type: 'weight',
      grams_per_serving: grams == null ? null : Math.round(grams * 1000) / 1000,
      serving_quantity: undefined,
      unit_name: undefined,
      grams_per_unit: undefined,
      serving_size_text,
    };
  }
  const gramEq = gram_equivalent === '' || gram_equivalent == null ? null : Number(gram_equivalent);
  return {
    tracking_type: 'unit',
    grams_per_serving: null,
    serving_quantity: amt,
    unit_name: unit,
    grams_per_unit: Number.isFinite(gramEq) && gramEq > 0 ? gramEq : undefined,
    serving_size_text,
  };
}

/** Stored ingredient row -> form serving fields (edit + clean migration of old data). */
export function servingFromRow(row) {
  if (!row) return emptyServing();
  if (row.tracking_type === 'unit') {
    const unit = String(row.unit_name || '').trim() || 'serving';
    const known = SERVING_UNITS.includes(unit);
    return {
      serving_amount: row.serving_quantity == null ? '1' : String(row.serving_quantity),
      serving_unit: known ? unit : 'custom',
      serving_unit_custom: known ? '' : unit,
      gram_equivalent: row.grams_per_unit == null ? '' : String(row.grams_per_unit),
    };
  }
  // Legacy "By weight" -> grams.
  return {
    serving_amount: row.grams_per_serving == null ? '' : String(row.grams_per_serving),
    serving_unit: 'g',
    serving_unit_custom: '',
    gram_equivalent: '',
  };
}

export function emptyServing() {
  return { serving_amount: '', serving_unit: 'g', serving_unit_custom: '', gram_equivalent: '' };
}

// Abbreviations never take a plural "s" — "3 gs" / "2 tbsps" read as typos.
// Anything else is a countable thing (egg, slice, spray, scoop, cup) that does.
const ABBREVIATED_UNITS = new Set(['g', 'kg', 'mg', 'oz', 'lb', 'lbs', 'ml', 'l', 'fl oz', 'tbsp', 'tsp']);

/**
 * "egg" -> "eggs", "dash" -> "dashes", "patty" -> "patties".
 * Units already stored plural ("sprays", "slices" — the AI logger writes those)
 * are left alone rather than becoming "sprayses".
 */
export function pluralizeUnit(unit, amount) {
  const u = String(unit ?? '').trim();
  if (!u || Number(amount) === 1) return u;
  if (ABBREVIATED_UNITS.has(u.toLowerCase())) return u;
  if (/s$/i.test(u)) return u;
  if (/(x|z|ch|sh)$/i.test(u)) return `${u}es`;
  if (/[^aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
  return `${u}s`;
}

/**
 * Amount + unit as one display string: "3 eggs", "170 g", "1 slice".
 * Unit-tracked ingredients store a COUNT, so labelling those grams is wrong —
 * see displayUnitForIngredient on the server, which picks the unit itself.
 */
export function formatAmountWithUnit(amount, unit) {
  // Number(null) is 0, so screen those out before converting.
  const n = amount === null || amount === undefined || amount === '' ? NaN : Number(amount);
  if (!Number.isFinite(n)) return String(unit ?? '').trim() || '—';
  const rounded = +n.toFixed(2);
  const u = pluralizeUnit(unit, rounded);
  return u ? `${rounded} ${u}` : String(rounded);
}

/** Label for the chosen unit (resolves "custom"). */
export function unitLabel({ serving_unit, serving_unit_custom }) {
  return serving_unit === 'custom' ? (String(serving_unit_custom || '').trim() || 'unit') : serving_unit;
}

/**
 * Which units an ingredient described by these form fields could be LOGGED in,
 * split into what works now and what recording the gram equivalent would add.
 * Drives the hint under that field, so it can say what it is actually for.
 */
export function loggableUnitsForServing(serving) {
  const stored = servingToStored(serving);
  const now = loggableUnitsFor(stored);
  // The same ingredient as if a weight had been recorded — the difference is
  // exactly what the gram-equivalent field unlocks.
  const withGrams = loggableUnitsFor({ ...stored, grams_per_unit: stored.grams_per_unit || 1 });
  return { now, unlocked: withGrams.filter(u => !now.includes(u)) };
}
