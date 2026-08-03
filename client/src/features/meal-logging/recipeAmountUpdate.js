/**
 * Writing the amounts you actually used back into the saved recipe.
 *
 * The log modal remembers per-slot amounts for next time (a local convenience),
 * but sometimes the new amount IS the recipe — 60g of blueberries was never
 * right, you always use 100g. This builds the recipe PUT body for that: the
 * slot amounts change, the ingredients themselves don't.
 *
 * Ingredient swaps are deliberately NOT baked in. A slot's default ingredient
 * is its first option, so macros are recomputed from the defaults at the new
 * amounts — otherwise a one-off substitution would quietly redefine the recipe.
 */
import { adjustPerServingMacrosForResolvedClient } from './recipeLogMacros';

/** Slot id for each recipe ingredient index, mirroring listLoggingSlotsFromRecipe. */
function slotIdsByIndex(recipe) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const meta = recipe?.meal_builder_meta && typeof recipe.meal_builder_meta === 'object' ? recipe.meal_builder_meta : null;
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const out = new Map();
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item) continue;
    if (item.kind === 'slot') {
      if (item.slot_id != null) out.set(i, String(item.slot_id));
      continue;
    }
    if (item.kind !== 'line') continue;
    const ml = metaLines[i];
    const lid = Number(ml?.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) continue;
    out.set(i, ml.slot_id != null && String(ml.slot_id).trim() !== '' ? String(ml.slot_id).trim() : `mb_legacy_${i}_${lid}`);
  }
  return out;
}

function sameAmount(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return String(a ?? '') === String(b ?? '');
  return Math.abs(x - y) < 1e-9;
}

/**
 * Does the current log's amounts differ from the recipe's own? Unit-tracked
 * slots compare on count only — their unit is the ingredient's own ("egg").
 */
export function amountsDifferFromRecipe(slots, amountsBySlot, labelById) {
  return (slots || []).some(slot => {
    const cur = amountsBySlot?.[slot.slot_id];
    if (!cur || cur.amount === '' || cur.amount == null) return false;
    if (!sameAmount(cur.amount, slot.amount)) return true;
    const defIng = labelById?.[String(slot.option_label_ingredient_ids?.[0])];
    if (defIng?.tracking_type === 'unit') return false;
    const curUnit = cur.unit === 'oz' ? 'oz' : 'g';
    const recipeUnit = slot.unit === 'oz' ? 'oz' : 'g';
    return curUnit !== recipeUnit;
  });
}

/**
 * Recipe PUT body with the new slot amounts and recomputed per-serving macros,
 * or null when the recipe can't be rescaled (a missing grams/serving, say) —
 * callers should hide the action rather than write a wrong recipe.
 *
 * @param {object} recipe        recipe as returned by the API
 * @param {Array}  slots         listLoggingSlotsFromRecipe(recipe)
 * @param {object} amountsBySlot { [slot_id]: { amount, unit } } from the log form
 * @param {object} labelById     label ingredients keyed by string id
 */
export function buildRecipeAmountUpdate(recipe, slots, amountsBySlot, labelById) {
  if (!recipe || !Array.isArray(slots) || slots.length === 0) return null;

  // Macros for the DEFAULT ingredient of every slot at the new amounts.
  const resolvedDefaults = {};
  for (const slot of slots) {
    const cur = amountsBySlot?.[slot.slot_id];
    const amount = cur?.amount != null && cur.amount !== '' ? String(cur.amount) : String(slot.amount);
    if (!(Number(amount) > 0)) return null;
    resolvedDefaults[slot.slot_id] = {
      label_ingredient_id: slot.option_label_ingredient_ids[0],
      amount,
      unit: cur?.unit === 'oz' ? 'oz' : 'g',
    };
  }
  const macros = adjustPerServingMacrosForResolvedClient(recipe, labelById, resolvedDefaults);
  if (!macros || !Number.isFinite(macros.calories)) return null;

  const bySlot = slotIdsByIndex(recipe);
  const ingredients = (recipe.ingredients || []).map((item, i) => {
    const slotId = bySlot.get(i);
    const next = resolvedDefaults[slotId];
    if (!slotId || !next || !item) return item;
    const defIng = labelById?.[String(next.label_ingredient_id)];
    const isUnitTracked = defIng?.tracking_type === 'unit';
    if (item.kind === 'slot') {
      // A unit-tracked slot stores the ingredient's own unit name ("egg"),
      // which the g/oz picker never touches — keep it as-is.
      return { ...item, amount: next.amount, unit: isUnitTracked ? item.unit : next.unit };
    }
    // Legacy Meal Builder line: its `amount` is display text.
    return { ...item, amount: isUnitTracked ? next.amount : `${next.amount} ${next.unit}` };
  });

  let meal_builder_meta = recipe.meal_builder_meta ?? undefined;
  if (meal_builder_meta && typeof meal_builder_meta === 'object' && Array.isArray(meal_builder_meta.lines)) {
    meal_builder_meta = {
      ...meal_builder_meta,
      lines: meal_builder_meta.lines.map((ln, i) => {
        const next = resolvedDefaults[bySlot.get(i)];
        if (!ln || !next) return ln;
        const defIng = labelById?.[String(next.label_ingredient_id)];
        return defIng?.tracking_type === 'unit'
          ? { ...ln, amount: Number(next.amount) }
          : { ...ln, amount: Number(next.amount), unit: next.unit };
      }),
    };
  }

  return {
    name: recipe.name,
    serving_size: recipe.serving_size,
    calories: Math.round(macros.calories * 10) / 10,
    protein_g: Math.round(macros.protein_g * 100) / 100,
    carbs_g: Math.round(macros.carbs_g * 100) / 100,
    fat_g: Math.round(macros.fat_g * 100) / 100,
    fiber_g: macros.fiber_g > 0 ? Math.round(macros.fiber_g * 100) / 100 : undefined,
    ingredients,
    ...(meal_builder_meta !== undefined ? { meal_builder_meta } : {}),
  };
}
