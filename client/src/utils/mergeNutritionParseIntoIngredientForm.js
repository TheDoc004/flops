/**
 * Applies {@link parseNutritionFactsText} output onto a string-based ingredient form.
 * Preserves fields not present in the parse; only fills `name` when the current name is blank.
 *
 * @param {Record<string, string>} prev
 * @param {object} parsed — result of `parseNutritionFactsText` (includes `scanWarnings`, `fieldStatus`)
 */
export function mergeNutritionParseIntoIngredientForm(prev, parsed) {
  const { scanWarnings = [], fieldStatus = {}, ...fields } = parsed;
  const next = { ...prev };

  if (!String(prev.name || '').trim() && fields.name) {
    next.name = String(fields.name).trim();
  }
  if (fields.serving_size_text) next.serving_size_text = fields.serving_size_text;
  if (fields.grams_per_serving != null) next.grams_per_serving = String(fields.grams_per_serving);
  if (fields.calories != null) next.calories = String(fields.calories);
  if (fields.fat_g != null) next.fat_g = String(fields.fat_g);
  if (fields.carbs_g != null) next.carbs_g = String(fields.carbs_g);
  if (fields.protein_g != null) next.protein_g = String(fields.protein_g);
  if (fields.fiber_g != null) next.fiber_g = String(fields.fiber_g);

  const countFilled = [
    fields.calories,
    fields.fat_g,
    fields.carbs_g,
    fields.protein_g,
    fields.fiber_g,
    fields.grams_per_serving,
  ].filter(v => v != null).length;

  const messages = [...scanWarnings];
  const priority = ['calories', 'carbs_g', 'protein_g', 'fat_g'];
  const anyMissing = priority.some(k => fieldStatus[k] === 'missing');

  if (countFilled > 0 && anyMissing) {
    messages.unshift('We filled what we could — please review highlighted fields against the label.');
  } else if (countFilled === 0 && messages.length === 0) {
    messages.push("We couldn't read numbers from this scan — add calories and macros from the packaging.");
  }

  return {
    next,
    scanFeedback: messages.length ? messages : null,
    countFilled,
    fieldStatus: { ...fieldStatus },
  };
}

/** CSS class for inputs after a scan (optional). */
export function scanFieldClass(status) {
  if (status === 'missing') return 'scan-field-missing';
  if (status === 'uncertain') return 'scan-field-review';
  return '';
}
