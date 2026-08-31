/** Fixed meal count shown while customizing layout (not the user's live log). */
export const EDIT_MEALS_PREVIEW_COUNT = 3;

/** Standard three-meal preview for layout edit mode. */
export const EDIT_MEALS_PREVIEW_ENTRIES = [
  {
    id: 'edit-preview-breakfast',
    recipe_name: 'Preset Breakfast',
    servings: 1,
    time_min: 480,
    recipe_calories: 420,
    recipe_protein_g: 28,
    recipe_carbs_g: 45,
    recipe_fat_g: 14,
  },
  {
    id: 'edit-preview-lunch',
    recipe_name: 'Preset Lunch',
    servings: 1,
    time_min: 750,
    recipe_calories: 580,
    recipe_protein_g: 42,
    recipe_carbs_g: 52,
    recipe_fat_g: 18,
  },
  {
    id: 'edit-preview-dinner',
    recipe_name: 'Preset Dinner',
    servings: 1,
    time_min: 1140,
    recipe_calories: 640,
    recipe_protein_g: 48,
    recipe_carbs_g: 58,
    recipe_fat_g: 22,
  },
];

export function editMealsPreviewTotals(entries = EDIT_MEALS_PREVIEW_ENTRIES) {
  return entries.reduce(
    (acc, e) => ({
      count: acc.count + 1,
      calories: acc.calories + (e.recipe_calories || 0),
    }),
    { count: 0, calories: 0 },
  );
}
