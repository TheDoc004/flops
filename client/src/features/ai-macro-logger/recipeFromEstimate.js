/**
 * Turns reviewed AI-logger rows into a recipe that is genuinely BUILT FROM
 * INGREDIENTS, rather than a template with one frozen macro total.
 *
 * Each row backed by an Ingredient Library entry becomes a real `slot` — the
 * same shape Meal Builder writes — so the saved recipe can later be reopened in
 * the builder to change amounts or swap an ingredient, and its macros are
 * recomputed from the library rather than read from a stored number. Rows the
 * AI couldn't quantify stay plain text lines: visible, but not editable.
 *
 * `ingredients` and `meal_builder_meta.lines` stay index-aligned, which is what
 * `listLoggingSlotsFromRecipe` on the server relies on to pair them.
 */

const fmt = v => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 100) / 100);
};

/**
 * @param {Array} rows reviewed estimate rows
 * @param {Array<number|null>} ids library id per row (index-aligned), null when none
 * @param {number} [divisor] splits amounts across meal-prep servings
 * @returns {{ingredients: Array, lines: Array}}
 */
export function buildLibraryBackedIngredients(rows, ids, divisor = 1) {
  const ingredients = [];
  const lines = [];
  const list = Array.isArray(rows) ? rows : [];
  const idList = Array.isArray(ids) ? ids : [];
  const div = Number(divisor) > 0 ? Number(divisor) : 1;

  list.forEach((i, idx) => {
    const name = String(i?.name || '').trim();
    if (!name) return;
    const qty = Number(i?.quantity) > 0 ? Number(i.quantity) / div : 0;
    const id = idList[idx];

    if (id && qty > 0) {
      const unit = /^(oz|ounce|ounces)$/i.test(i?.unit || '') ? 'oz' : 'g';
      const slot_id = `ai_line_${ingredients.length}`;
      ingredients.push({
        kind: 'slot',
        slot_id,
        label: name,
        amount: String(qty),
        unit,
        option_label_ingredient_ids: [id],
      });
      lines.push({
        label_ingredient_id: id,
        name,
        role_label: name,
        amount: String(qty),
        unit,
        slot_id,
        substitute_label_ingredient_ids: [],
      });
    } else {
      ingredients.push({
        kind: 'line',
        name,
        amount: qty > 0 ? `${fmt(qty)} ${i?.unit || ''}`.trim() : 'as estimated',
      });
      lines.push({}); // keep index alignment
    }
  });

  return { ingredients, lines };
}

/**
 * True when a recipe's lines are backed by library ingredients — whoever made
 * it. Decides whether "Edit in Builder" opens the ingredient flow.
 */
export function isIngredientBuilt(recipe) {
  const lines = recipe?.meal_builder_meta?.lines;
  return Array.isArray(lines) && lines.some(l => l && l.label_ingredient_id != null);
}
