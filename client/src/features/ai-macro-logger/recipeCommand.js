import { listLoggingSlotsFromRecipe, listNonEditableTemplateLines } from '@features/meal-logging';
import { macrosForLabelServingAmount } from '@features/label-ocr';

export const normName = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

function tokenSet(s) { return new Set(normName(s).split(' ').filter(Boolean)); }
function tokenOverlap(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.max(A.size, B.size);
}

/**
 * Match an AI-suggested recipe name against the REAL saved recipe list.
 * Exact (normalized) first, then fuzzy (substring either way, or strong token
 * overlap). Returns { status: 'one'|'many'|'none', recipe?, candidates[] } so the
 * caller can proceed, show a picker, or fall back to a freeform estimate. The AI
 * never silently picks — we resolve against the real library here.
 */
export function matchRecipe(aiName, recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  if (!aiName || !list.length) return { status: 'none', candidates: [] };
  const norm = normName(aiName);

  const exact = list.filter(r => normName(r.name) === norm);
  if (exact.length === 1) return { status: 'one', recipe: exact[0], candidates: exact };
  if (exact.length > 1) return { status: 'many', candidates: exact };

  const fuzzy = list.filter(r => {
    const rn = normName(r.name);
    return rn.includes(norm) || norm.includes(rn) || tokenOverlap(rn, norm) >= 0.6;
  });
  if (fuzzy.length === 1) return { status: 'one', recipe: fuzzy[0], candidates: fuzzy };
  if (fuzzy.length > 1) return { status: 'many', candidates: fuzzy };
  return { status: 'none', candidates: [] };
}

/**
 * Per-ingredient display rows for the recipe review screen, computed from the
 * SAVED recipe + the user's label-ingredient library (display preview only — the
 * actual logged rows come from the server's recipe-log resolution). Macro-bearing
 * slots get macros; manual name-only lines render without macros.
 */
export function recipeReviewRows(recipe, labelById) {
  const rows = [];
  for (const slot of listLoggingSlotsFromRecipe(recipe)) {
    const id = slot.option_label_ingredient_ids?.[0];
    const ing = id != null && labelById ? labelById.get(Number(id)) : null;
    const m = ing ? macrosForLabelServingAmount(ing, slot.amount, slot.unit) : null;
    rows.push({
      name: (ing && ing.name) || slot.label,
      amount: Number(slot.amount),
      unit: slot.unit,
      calories: m ? m.calories : null,
      protein_g: m ? m.protein_g : null,
      carbs_g: m ? m.carbs_g : null,
      fat_g: m ? m.fat_g : null,
      label_ingredient_id: id != null ? Number(id) : undefined,
    });
  }
  for (const line of listNonEditableTemplateLines(recipe)) {
    rows.push({ name: line.name, amountText: line.amount, calories: null, protein_g: null, carbs_g: null, fat_g: null });
  }
  return rows;
}
