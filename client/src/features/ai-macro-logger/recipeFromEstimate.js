/**
 * Turns reviewed AI-logger rows into a recipe built from library ingredients.
 * Each library-backed row becomes a named ingredient line (no slots / substitutes).
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
      const rawUnit = String(i?.unit || '').trim();
      const unit = /^(oz|ounce|ounces)$/i.test(rawUnit)
        ? 'oz'
        : (/^(g|gram|grams)$/i.test(rawUnit) || !rawUnit ? 'g' : rawUnit);
      ingredients.push({
        kind: 'ingredient',
        name,
        amount: String(qty),
        unit,
        label_ingredient_id: id,
      });
      lines.push({
        label_ingredient_id: id,
        name,
        amount: String(qty),
        unit,
      });
    } else {
      ingredients.push({
        kind: 'line',
        name,
        amount: qty > 0 ? `${fmt(qty)} ${i?.unit || ''}`.trim() : 'as estimated',
      });
      lines.push({});
    }
  });

  return { ingredients, lines };
}

/**
 * True when a recipe's lines are backed by library ingredients.
 */
export function isIngredientBuilt(recipe) {
  if (Array.isArray(recipe?.ingredients) && recipe.ingredients.some(i => i?.kind === 'ingredient' && i.label_ingredient_id != null)) {
    return true;
  }
  const lines = recipe?.meal_builder_meta?.lines;
  return Array.isArray(lines) && lines.some(l => l && l.label_ingredient_id != null);
}
