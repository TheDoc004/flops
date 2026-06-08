/**
 * Slots used for recipe logging / macro adjustment: real `kind: 'slot'` rows plus
 * legacy Meal Builder rows stored as `kind: 'line'` but with `meal_builder_meta.lines[i].label_ingredient_id`.
 * Order matches the recipe ingredients array.
 */

function tryParseLineAmountForVirtual(lineItem) {
  const s = String(lineItem?.amount ?? '').trim();
  const m = /^([\d.]+)\s*(g|oz)?\s*$/i.exec(s.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || 'g').toLowerCase();
  return { amount: String(n), unit: u === 'oz' ? 'oz' : 'g' };
}

/**
 * @param {object} recipe - parsed recipe from API (ingredients array, optional meal_builder_meta)
 * @returns {Array<object>} slot-shaped rows in recipe order
 */
export function listLoggingSlotsFromRecipe(recipe) {
  if (!recipe) return [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const meta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object' ? recipe.meal_builder_meta : null;
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const out = [];
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item) continue;
    if (item.kind === 'slot') {
      out.push(item);
      continue;
    }
    if (item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (!ml || ml.label_ingredient_id == null) continue;
    const lid = Number(ml.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) continue;
    let amountStr = ml.amount != null && String(ml.amount).trim() !== '' ? String(ml.amount).trim() : '';
    let unit = ml.unit === 'oz' ? 'oz' : 'g';
    if (!amountStr || Number(amountStr) <= 0) {
      const fb = tryParseLineAmountForVirtual(item);
      if (fb) {
        amountStr = fb.amount;
        unit = fb.unit;
      }
    }
    if (!amountStr || Number(Number(amountStr)) <= 0) continue;
    const slotId =
      ml.slot_id != null && String(ml.slot_id).trim() !== '' ? String(ml.slot_id).trim() : `mb_legacy_${i}_${lid}`;
    out.push({
      kind: 'slot',
      slot_id: slotId,
      label: item.name,
      amount: amountStr,
      unit,
      option_label_ingredient_ids: [lid],
    });
  }
  return out;
}

/**
 * Free-text lines with no library link (manual recipe lines only).
 */
export function listNonEditableTemplateLines(recipe) {
  if (!recipe) return [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const meta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object' ? recipe.meal_builder_meta : null;
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const lines = [];
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item || item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (ml && ml.label_ingredient_id != null) continue;
    lines.push(item);
  }
  return lines;
}
