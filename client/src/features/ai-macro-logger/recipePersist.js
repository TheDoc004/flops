/**
 * Helpers for updating a saved recipe from the AI logger.
 * Logging a modified meal never mutates the recipe; these builders produce
 * PUT bodies when the user explicitly chooses to update the recipe.
 */

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The fields PUT /api/recipes/:id requires, carried over unchanged. */
function baseBody(recipe) {
  return {
    name: recipe.name,
    serving_size: recipe.serving_size || '1 meal',
    calories: num(recipe.calories),
    protein_g: num(recipe.protein_g),
    carbs_g: num(recipe.carbs_g),
    fat_g: num(recipe.fat_g),
    ...(recipe.fiber_g != null ? { fiber_g: num(recipe.fiber_g) } : {}),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    meal_builder_meta: recipe.meal_builder_meta || null,
  };
}

/**
 * Append a saved ingredient to the recipe as a named ingredient line.
 *
 * @param row { label_ingredient_id, name, amount, unit, calories, protein_g, carbs_g, fat_g }
 * @returns a PUT body, or null when the row isn't library-backed.
 */
export function addIngredientToRecipe(recipe, row) {
  const id = Number(row?.label_ingredient_id);
  if (!recipe || !Number.isInteger(id) || id <= 0) return null;
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = row.unit || 'g';
  const ingredients = [
    ...(Array.isArray(recipe.ingredients) ? recipe.ingredients : []),
    { kind: 'ingredient', name: row.name, amount: String(amount), unit, label_ingredient_id: id },
  ];

  const body = baseBody(recipe);
  return {
    ...body,
    calories: Math.round((body.calories + num(row.calories)) * 10) / 10,
    protein_g: Math.round((body.protein_g + num(row.protein_g)) * 100) / 100,
    carbs_g: Math.round((body.carbs_g + num(row.carbs_g)) * 100) / 100,
    fat_g: Math.round((body.fat_g + num(row.fat_g)) * 100) / 100,
    ingredients,
  };
}
