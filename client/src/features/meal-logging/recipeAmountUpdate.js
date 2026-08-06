/**
 * Comparing a log's per-slot amounts against the recipe's own.
 *
 * The log modal remembers per-slot amounts for next time (a local convenience),
 * so it needs to know when what you're logging has drifted from the saved
 * recipe — that's what gates the "Use recipe amounts" reset. Editing the recipe
 * itself belongs to the recipe editor, not to logging a meal.
 */
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
