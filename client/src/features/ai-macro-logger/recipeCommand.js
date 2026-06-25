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
 * Exact (normalized) first, then fuzzy. Returns { status: 'one'|'many'|'none',
 * recipe?, candidates[] }. The AI never silently picks — we resolve here.
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

/** Display ingredient names for a recipe (sent to the AI so it can target them). */
export function recipeIngredientNames(recipe, labelById) {
  const out = [];
  const seen = new Set();
  const push = nm => { const n = String(nm || '').trim(); if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); } };
  for (const slot of listLoggingSlotsFromRecipe(recipe)) {
    const id = slot.option_label_ingredient_ids?.[0];
    const ing = id != null && labelById ? labelById.get(Number(id)) : null;
    push((ing && ing.name) || slot.label);
  }
  for (const line of listNonEditableTemplateLines(recipe)) push(line.name);
  return out;
}

function slotDisplayName(slot, labelById) {
  const id = slot.option_label_ingredient_ids?.[0];
  const ing = id != null && labelById ? labelById.get(Number(id)) : null;
  return (ing && ing.name) || slot.label;
}

/**
 * Apply AI-detected modifications to a recipe's slots, producing the data needed
 * to log a customized instance through the normal recipe-log endpoint.
 *
 * Returns:
 *   - customizations: { [slot_id]: {label_ingredient_id, amount, unit} } for the
 *     CHANGED slots only (sent as log_slot_customizations; server defaults the rest).
 *   - resolvedBySlot: every slot resolved (default + changes) — for the preview.
 *   - servingsScale: number|null (whole-recipe scale, e.g. 0.5 for half).
 *   - applied: string[] summaries; unapplied: [{text, reason}] shown in review.
 *
 * Only remove / set_amount / substitute-to-library / scale are applied here;
 * add and non-library substitutes are surfaced as "couldn't apply" (Phase 3).
 */
export function applyModifications(recipe, modifications, labelById, labelByName) {
  const slots = listLoggingSlotsFromRecipe(recipe);
  const resolvedBySlot = {};
  for (const s of slots) {
    resolvedBySlot[s.slot_id] = {
      label_ingredient_id: s.option_label_ingredient_ids?.[0],
      amount: String(s.amount),
      unit: s.unit === 'oz' ? 'oz' : 'g',
    };
  }

  // Index slots by both the recipe label and the library ingredient name.
  const slotByName = new Map();
  for (const s of slots) {
    slotByName.set(normName(s.label), s);
    slotByName.set(normName(slotDisplayName(s, labelById)), s);
  }
  const findSlot = target => {
    if (!target) return null;
    const t = normName(target);
    if (slotByName.has(t)) return slotByName.get(t);
    for (const [name, s] of slotByName) if (name.includes(t) || t.includes(name)) return s;
    return null;
  };

  const customizations = {};
  const applied = [];
  const unapplied = [];
  let servingsScale = null;

  for (const m of modifications || []) {
    if (m.type === 'scale') {
      // The model sometimes puts the factor in "quantity" instead of "scale".
      const sc = Number(m.scale) > 0 ? Number(m.scale) : (Number(m.quantity) > 0 ? Number(m.quantity) : null);
      if (sc != null) {
        servingsScale = sc;
        applied.push(`Scale to ${sc}× of the recipe`);
      }
      continue;
    }
    const slot = findSlot(m.target);
    if (!slot) {
      if (m.type === 'add') unapplied.push({ text: `Add ${[m.quantity, m.unit, m.newName].filter(Boolean).join(' ')}`.trim(), reason: 'Adding new ingredients isn’t supported yet' });
      else unapplied.push({ text: `${m.type} ${m.target || ''}`.trim(), reason: `“${m.target || 'that ingredient'}” isn’t in this recipe` });
      continue;
    }
    const cur = resolvedBySlot[slot.slot_id];
    const name = slotDisplayName(slot, labelById);

    if (m.type === 'remove' || (m.type === 'set_amount' && Number(m.quantity) <= 0)) {
      resolvedBySlot[slot.slot_id] = { ...cur, amount: '0' };
      customizations[slot.slot_id] = { label_ingredient_id: cur.label_ingredient_id, amount: '0', unit: cur.unit };
      applied.push(`Removed ${name}`);
    } else if (m.type === 'set_amount') {
      const unit = m.unit === 'oz' ? 'oz' : (m.unit === 'g' ? 'g' : cur.unit);
      const amount = String(m.quantity);
      resolvedBySlot[slot.slot_id] = { ...cur, amount, unit };
      customizations[slot.slot_id] = { label_ingredient_id: cur.label_ingredient_id, amount, unit };
      applied.push(`Set ${name} to ${amount} ${unit}`);
    } else if (m.type === 'substitute') {
      const sub = labelByName ? labelByName.get(normName(m.newName)) : null;
      if (sub && sub.id != null) {
        const unit = m.unit === 'oz' ? 'oz' : (m.unit === 'g' ? 'g' : cur.unit);
        const amount = m.quantity != null && Number(m.quantity) > 0 ? String(m.quantity) : cur.amount;
        // Only apply if the substitute has enough data to compute macros — else
        // the recipe-log endpoint would reject it; surface it instead.
        if (macrosForLabelServingAmount(sub, amount, unit)) {
          resolvedBySlot[slot.slot_id] = { label_ingredient_id: Number(sub.id), amount, unit };
          customizations[slot.slot_id] = { label_ingredient_id: Number(sub.id), amount, unit };
          applied.push(`Substituted ${name} → ${sub.name}`);
        } else {
          unapplied.push({ text: `Substitute ${name} → ${sub.name}`, reason: `“${sub.name}” needs nutrition info (grams per serving) before it can be used` });
        }
      } else {
        unapplied.push({ text: `Substitute ${name} → ${m.newName || '?'}`, reason: `“${m.newName || 'that ingredient'}” isn’t in your ingredient library yet` });
      }
    } else if (m.type === 'add') {
      unapplied.push({ text: `Add ${[m.quantity, m.unit, m.newName].filter(Boolean).join(' ')}`.trim(), reason: 'Adding new ingredients isn’t supported yet' });
    }
  }

  return { customizations, resolvedBySlot, servingsScale, applied, unapplied };
}

/**
 * Per-ingredient preview rows after applying the resolved selections (display
 * only — the logged rows come from the server's recipe-log resolution). Removed
 * (amount<=0) slots are dropped; manual name-only lines render without macros.
 */
export function resolvedReviewRows(recipe, labelById, resolvedBySlot) {
  const rows = [];
  for (const slot of listLoggingSlotsFromRecipe(recipe)) {
    const res = resolvedBySlot?.[slot.slot_id] || {
      label_ingredient_id: slot.option_label_ingredient_ids?.[0],
      amount: slot.amount,
      unit: slot.unit,
    };
    const amt = Number(res.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue; // removed
    const ing = res.label_ingredient_id != null && labelById ? labelById.get(Number(res.label_ingredient_id)) : null;
    const m = ing ? macrosForLabelServingAmount(ing, res.amount, res.unit) : null;
    rows.push({
      name: (ing && ing.name) || slot.label,
      amount: amt,
      unit: res.unit,
      calories: m ? m.calories : null,
      protein_g: m ? m.protein_g : null,
      carbs_g: m ? m.carbs_g : null,
      fat_g: m ? m.fat_g : null,
    });
  }
  for (const line of listNonEditableTemplateLines(recipe)) {
    rows.push({ name: line.name, amountText: line.amount, calories: null, protein_g: null, carbs_g: null, fat_g: null });
  }
  return rows;
}
