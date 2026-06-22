import { gramsFromAmount } from '@features/label-ocr';
import { listLoggingSlotsFromRecipe } from './recipeLoggingSlots';

/**
 * Client-side mirror of server `adjustPerServingMacrosForResolvedSlots` for live preview.
 * Returns null if any slot is missing data or an ingredient cannot be scaled (no grams/serving).
 */
export function adjustPerServingMacrosForResolvedClient(recipe, labelById, resolvedBySlot) {
  if (!recipe || !resolvedBySlot || typeof resolvedBySlot !== 'object') return null;
  const base = {
    calories: Number(recipe.calories),
    protein_g: Number(recipe.protein_g),
    carbs_g: Number(recipe.carbs_g),
    fat_g: Number(recipe.fat_g),
    fiber_g: recipe.fiber_g != null && recipe.fiber_g !== '' ? Number(recipe.fiber_g) : 0,
  };
  const slots = listLoggingSlotsFromRecipe(recipe);
  if (slots.length === 0) return base;

  function macrosForIngredientAmount(ing, amountValue, unit) {
    if (ing.tracking_type === 'unit') {
      const count = Number(amountValue);
      if (!Number.isFinite(count) || count < 0) return null;
      const sq = Number(ing.serving_quantity);
      const mult = count / (Number.isFinite(sq) && sq > 0 ? sq : 1);
      return {
        calories: Number(ing.calories) * mult,
        protein_g: Number(ing.protein_g) * mult,
        carbs_g: Number(ing.carbs_g) * mult,
        fat_g: Number(ing.fat_g) * mult,
        fiber_g: ing.fiber_g != null && ing.fiber_g !== '' ? Number(ing.fiber_g) * mult : 0,
      };
    }
    const gps = Number(ing.grams_per_serving);
    if (!Number.isFinite(gps) || gps <= 0) return null;
    const grams = gramsFromAmount(amountValue, unit, { allowZero: true });
    if (grams == null) return null;
    const mult = grams / gps;
    return {
      calories: Number(ing.calories) * mult,
      protein_g: Number(ing.protein_g) * mult,
      carbs_g: Number(ing.carbs_g) * mult,
      fat_g: Number(ing.fat_g) * mult,
      fiber_g: ing.fiber_g != null && ing.fiber_g !== '' ? Number(ing.fiber_g) * mult : 0,
    };
  }

  let adj = { ...base };
  for (const slot of slots) {
    const res = resolvedBySlot[slot.slot_id];
    if (!res) return null;
    const defId = slot.option_label_ingredient_ids[0];
    const selId = res.label_ingredient_id;
    const defIng = labelById[String(defId)];
    const selIng = labelById[String(selId)];
    if (!defIng || !selIng) return null;
    const mDef = macrosForIngredientAmount(defIng, slot.amount, slot.unit);
    const mSel = macrosForIngredientAmount(selIng, res.amount, res.unit);
    if (!mDef || !mSel) return null;
    adj.calories += -mDef.calories + mSel.calories;
    adj.protein_g += -mDef.protein_g + mSel.protein_g;
    adj.carbs_g += -mDef.carbs_g + mSel.carbs_g;
    adj.fat_g += -mDef.fat_g + mSel.fat_g;
    adj.fiber_g += -mDef.fiber_g + mSel.fiber_g;
  }
  return adj;
}
