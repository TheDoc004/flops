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

/** Label for the chosen unit (resolves "custom"). */
export function unitLabel({ serving_unit, serving_unit_custom }) {
  return serving_unit === 'custom' ? (String(serving_unit_custom || '').trim() || 'unit') : serving_unit;
}
