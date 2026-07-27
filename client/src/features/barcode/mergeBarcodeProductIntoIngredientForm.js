/**
 * Applies an Open Food Facts lookup onto the ingredient form, mirroring
 * {@link mergeNutritionParseIntoIngredientForm} so a barcode scan and a label
 * scan feel identical: fields fill in, uncertain ones get highlighted, and a
 * "review this" list explains what to double-check.
 *
 * Nothing here saves anything — the user always confirms the form.
 */

const MACRO_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];
const MACRO_LABELS = {
  calories: 'calories',
  protein_g: 'protein',
  carbs_g: 'carbs',
  fat_g: 'fat',
  fiber_g: 'fiber',
};
// Fiber is left out: plenty of real labels genuinely don't list it, so
// flagging it every time would train you to ignore the whole panel.
const REQUIRED_MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

/**
 * @param {Record<string, string>} prev current form values
 * @param {object} product `GET /api/barcode/:code` response
 * @returns {{next: object, scanFeedback: string[]|null, fieldStatus: object, countFilled: number}}
 */
export function mergeBarcodeProductIntoIngredientForm(prev, product) {
  const next = { ...prev };
  const fieldStatus = {};
  const messages = [];
  const macros = product?.macros || {};

  // Name and brand only fill a blank field — never overwrite something typed.
  if (!String(prev.name || '').trim() && product?.name) next.name = String(product.name).trim();
  if (!String(prev.brand_name || '').trim() && product?.brand_name) {
    next.brand_name = String(product.brand_name).trim();
  }

  if (product?.serving_amount != null) {
    next.serving_amount = String(product.serving_amount);
    next.serving_unit = product.serving_unit === 'ml' ? 'ml' : 'g';
    next.serving_unit_custom = '';
  }

  let countFilled = 0;
  for (const key of MACRO_KEYS) {
    const value = macros[key];
    if (value != null) {
      next[key] = String(value);
      countFilled += 1;
      // Anything not printed per-serving on the package is worth a second look.
      if (product?.basis === 'serving_derived') fieldStatus[key] = 'uncertain';
    } else if (REQUIRED_MACROS.includes(key)) {
      fieldStatus[key] = 'missing';
    }
  }

  const servingText = product?.serving_size_text ? ` (label says "${product.serving_size_text}")` : '';
  const amountText = `${product?.serving_amount ?? ''} ${product?.serving_unit || 'g'}`.trim();

  if (product?.basis === 'none') {
    messages.push(
      'This product has no nutrition data in Open Food Facts yet — add the numbers from the packaging, or scan the label instead.'
    );
  } else if (product?.basis === 'serving_derived') {
    fieldStatus.serving_amount = 'uncertain';
    messages.push(`Macros were calculated for a ${amountText} serving${servingText} from the per-100 ${product?.serving_unit === 'ml' ? 'ml' : 'g'} values.`);
  } else if (product?.basis === '100g') {
    fieldStatus.serving_amount = 'uncertain';
    messages.push('No serving size on record, so these are per 100 g. Change the amount if you use a different portion.');
  }

  const missing = REQUIRED_MACROS.filter(k => fieldStatus[k] === 'missing');
  if (missing.length) {
    messages.push(`Not listed for this product: ${missing.map(k => MACRO_LABELS[k]).join(', ')}.`);
  }
  if (countFilled > 0) {
    messages.push('Open Food Facts is crowd-sourced — check these against the packaging before saving.');
  }

  return {
    next,
    scanFeedback: messages.length ? messages : null,
    fieldStatus,
    countFilled,
  };
}
