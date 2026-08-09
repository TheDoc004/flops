/**
 * Turning a one-off swap into part of the saved recipe.
 *
 * Logging a modified recipe never touches the recipe itself — that's the point
 * of the custom-log path. But a swap you keep making ("sweet potato instead of
 * the toast") shouldn't stay a one-off forever, so these builders produce the
 * PUT body that teaches the recipe about it. Pure: no API calls, no mutation of
 * the recipe passed in.
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

/** meal_builder_meta.lines as an array (empty when the recipe has no meta). */
function metaLines(recipe) {
  const meta = recipe?.meal_builder_meta;
  return meta && Array.isArray(meta.lines) ? meta.lines : [];
}

/**
 * Offer `ingredientId` as another choice for one slot — the "it wasn't on the
 * list of substitutes, now it is" change. The slot's DEFAULT (first id) is
 * untouched, so the recipe's own macros don't move.
 *
 * @returns a PUT body, or null when the slot is unknown or already offers it.
 */
export function addSubstituteOption(recipe, slotId, ingredientId) {
  const id = Number(ingredientId);
  if (!recipe || !slotId || !Number.isInteger(id) || id <= 0) return null;

  let changed = false;
  const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(item => {
    if (!item || item.kind !== 'slot' || String(item.slot_id) !== String(slotId)) return item;
    const ids = Array.isArray(item.option_label_ingredient_ids) ? item.option_label_ingredient_ids.map(Number) : [];
    if (ids.includes(id)) return item;
    changed = true;
    return { ...item, option_label_ingredient_ids: [...ids, id] };
  });
  if (!changed) return null;

  // Legacy Meal Builder rows live as lines + meta; keep the two in step so the
  // Meal Builder shows the same substitute list the logger just used.
  const lines = metaLines(recipe);
  const meta = lines.length
    ? {
        ...recipe.meal_builder_meta,
        lines: lines.map(l => {
          if (!l || String(l.slot_id) !== String(slotId)) return l;
          const subs = Array.isArray(l.substitute_label_ingredient_ids) ? l.substitute_label_ingredient_ids.map(Number) : [];
          return subs.includes(id) ? l : { ...l, substitute_label_ingredient_ids: [...subs, id] };
        }),
      }
    : recipe.meal_builder_meta || null;

  return { ...baseBody(recipe), ingredients, meal_builder_meta: meta };
}

/**
 * Append a saved ingredient to the recipe as a new editable slot, and fold its
 * macros into the recipe's own totals (recipes are stored per serving, and a
 * Meal Builder recipe is "1 meal", so the row's macros add directly).
 *
 * @param row { label_ingredient_id, name, amount, unit, calories, protein_g, carbs_g, fat_g }
 * @returns a PUT body, or null when the row isn't library-backed.
 */
export function addIngredientToRecipe(recipe, row) {
  const id = Number(row?.label_ingredient_id);
  if (!recipe || !Number.isInteger(id) || id <= 0) return null;
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const slot_id = `ai_added_${id}_${Date.now()}`;
  const unit = row.unit || 'g';
  const ingredients = [
    ...(Array.isArray(recipe.ingredients) ? recipe.ingredients : []),
    { kind: 'slot', slot_id, label: row.name, amount: String(amount), unit, option_label_ingredient_ids: [id] },
  ];

  // The server pairs meta lines with ingredients BY INDEX, so a line is only
  // appended when the two are already aligned. The new row is a real slot and
  // works without meta, so leaving a ragged meta alone costs nothing.
  const lines = metaLines(recipe);
  const aligned = lines.length > 0 && lines.length === (Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0);
  const meta = aligned
    ? {
        ...recipe.meal_builder_meta,
        lines: [...lines, { label_ingredient_id: id, name: row.name, role_label: null, amount, unit, slot_id }],
      }
    : recipe.meal_builder_meta || null;

  const body = baseBody(recipe);
  return {
    ...body,
    calories: Math.round((body.calories + num(row.calories)) * 10) / 10,
    protein_g: Math.round((body.protein_g + num(row.protein_g)) * 100) / 100,
    carbs_g: Math.round((body.carbs_g + num(row.carbs_g)) * 100) / 100,
    fat_g: Math.round((body.fat_g + num(row.fat_g)) * 100) / 100,
    ingredients,
    meal_builder_meta: meta,
  };
}
