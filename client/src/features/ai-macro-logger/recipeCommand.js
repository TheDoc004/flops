import { listLoggingSlotsFromRecipe, listNonEditableTemplateLines } from '@features/meal-logging';
import { macrosForLabelServingAmount } from '@features/label-ocr';
import { bestLibraryMatch, libraryMacrosFor, MATCH_THRESHOLD } from './ingredientSource';

export const normName = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const macroNum = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 10) / 10 : 0);
const hasMacroEstimate = m => [m.calories, m.protein, m.carbs, m.fat].some(v => v != null);

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

/** The saved ingredient library as a plain array, from either index map. */
function libraryFrom(labelById, labelByName) {
  const src = labelById?.values ? labelById : (labelByName?.values ? labelByName : null);
  return src ? [...src.values()] : [];
}

/**
 * Resolve a substituted/added ingredient NAME to a saved library ingredient.
 * Exact (normalized) name first, then the same fuzzy scorer the freeform rows
 * use — the AI writes "sweet potato", the library says "Sweet Potato, raw", and
 * an exact-only lookup would silently downgrade a real ingredient (with its
 * label macros AND label micros) to an AI guess.
 *
 * A slot's own option list is deliberately NOT consulted: any saved ingredient
 * is a valid one-off swap, and the server accepts any ingredient you own.
 */
function findLibraryIngredient(name, labelByName, library) {
  if (!name) return null;
  const exact = labelByName ? labelByName.get(normName(name)) : null;
  if (exact && exact.id != null) return exact;
  const { best, score } = bestLibraryMatch(name, library);
  return best && best.id != null && score >= MATCH_THRESHOLD ? best : null;
}

/**
 * The amount/unit to log a saved ingredient at: what the AI said when it's
 * usable, otherwise one serving of that ingredient ("add blueberries" with no
 * amount shouldn't lose to a missing number).
 */
export function amountFor(ing, quantity, unit) {
  const q = Number(quantity);
  if (Number.isFinite(q) && q > 0 && unit) return [q, unit];
  if (ing.tracking_type === 'unit') {
    const sq = Number(ing.serving_quantity);
    return [Number.isFinite(sq) && sq > 0 ? sq : 1, String(ing.unit_name || 'unit')];
  }
  const gps = Number(ing.grams_per_serving);
  return [gps > 0 ? gps : 100, 'g'];
}

/** A library-backed row for the custom-log path (carries the id, so label micros apply). */
function libraryRow(ing, amount, unit) {
  const m = libraryMacrosFor(ing, amount, unit);
  if (!m) return null;
  return {
    name: ing.name,
    amount: Number(amount),
    unit,
    calories: macroNum(m.calories),
    protein_g: macroNum(m.protein_g),
    carbs_g: macroNum(m.carbs_g),
    fat_g: macroNum(m.fat_g),
    source: 'library',
    label_ingredient_id: Number(ing.id),
  };
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
 *   - droppedLines: Set of non-editable template line names replaced/removed here.
 *   - keepable: changes that could be saved into the recipe itself (recipePersist).
 *   - applied: string[] summaries; unapplied: [{text, reason, modIndex, fix?}].
 *
 * Substitutes and adds are NOT limited to a slot's saved option list — any
 * ingredient in your library is a valid one-off swap, and anything the library
 * doesn't have becomes an AI-estimated row (which routes the log through the
 * custom path so the saved recipe itself is never touched).
 */
export function applyModifications(recipe, modifications, labelById, labelByName) {
  const slots = listLoggingSlotsFromRecipe(recipe);
  const library = libraryFrom(labelById, labelByName);
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

  // Name-only template lines carry no macros, but they're still ingredients the
  // user can remove or swap out — matching one has to beat "isn't in this recipe".
  const lineNames = listNonEditableTemplateLines(recipe).map(l => String(l.name || '')).filter(Boolean);
  const findLine = target => {
    if (!target) return null;
    const t = normName(target);
    return lineNames.find(nm => normName(nm) === t)
      || lineNames.find(nm => normName(nm).includes(t) || t.includes(normName(nm)))
      || null;
  };

  const customizations = {};
  const applied = [];
  const unapplied = [];
  const addedRows = []; // extra rows (add / non-slot substitute) — need the custom-log path
  const droppedLines = new Set();
  // Changes that could be kept in the saved recipe, not just this log (see
  // recipePersist). Only library-backed ones: the recipe stores ingredient ids.
  const keepable = [];
  let servingsScale = null;

  const mods = Array.isArray(modifications) ? modifications : [];
  for (let modIndex = 0; modIndex < mods.length; modIndex++) {
    const m = mods[modIndex];
    /**
     * Record a change we couldn't make. `wanted` names the ingredient the user
     * asked for, which lets the review card offer to resolve it by hand —
     * dropping the item silently would quietly undercount the meal.
     */
    const cantApply = (text, reason, wanted) => {
      unapplied.push({
        text, reason, modIndex,
        ...(wanted ? { fix: { kind: m.type, name: wanted, quantity: m.quantity ?? null, unit: m.unit || '' } } : {}),
      });
    };
    if (m.type === 'scale') {
      // The model sometimes puts the factor in "quantity" instead of "scale".
      const sc = Number(m.scale) > 0 ? Number(m.scale) : (Number(m.quantity) > 0 ? Number(m.quantity) : null);
      if (sc != null) {
        servingsScale = sc;
        applied.push(`Scale to ${sc}× of the recipe`);
      }
      continue;
    }
    if (m.type === 'add') {
      // An ingredient that isn't in the recipe at all. Your library first (real
      // macros + label micros), AI estimate second.
      const name = m.newName || m.target;
      const lib = findLibraryIngredient(name, labelByName, library);
      const row = lib ? libraryRow(lib, ...amountFor(lib, m.quantity, m.unit)) : null;
      if (row) {
        addedRows.push(row);
        applied.push(`Added ${row.name}${normName(row.name) === normName(name) ? '' : ` (matched “${name}”)`} from your library`);
        keepable.push({ kind: 'ingredient', row, label: `Add ${row.name} to the recipe` });
      } else if (name && hasMacroEstimate(m)) {
        addedRows.push({
          name, amount: m.quantity != null ? Number(m.quantity) : null, unit: m.unit || '',
          calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
          source: 'ai',
        });
        const calOnly = m.calories != null && m.protein == null && m.carbs == null && m.fat == null;
        applied.push(`Added ${name} (AI estimate${calOnly ? ', calories only' : ''})`);
      } else {
        cantApply(`Add ${[m.quantity, m.unit, name].filter(Boolean).join(' ')}`.trim() || 'Add ingredient', 'couldn’t estimate this item’s macros', name);
      }
      continue;
    }
    const slot = findSlot(m.target);
    if (!slot) {
      // A name-only template line: no macros to adjust, but removing or swapping
      // it out is still meaningful.
      const line = findLine(m.target);
      if (line && m.type === 'remove') {
        droppedLines.add(line);
        applied.push(`Removed ${line}`);
      } else if (line && m.type === 'substitute') {
        const lib = findLibraryIngredient(m.newName, labelByName, library);
        const row = lib ? libraryRow(lib, ...amountFor(lib, m.quantity, m.unit)) : null;
        if (row) {
          droppedLines.add(line);
          addedRows.push(row);
          applied.push(`Substituted ${line} → ${row.name} (from your library)`);
        } else if (m.newName && hasMacroEstimate(m)) {
          droppedLines.add(line);
          addedRows.push({
            name: m.newName, amount: m.quantity != null ? Number(m.quantity) : null, unit: m.unit || '',
            calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
            source: 'ai',
          });
          applied.push(`Substituted ${line} → ${m.newName} (AI estimate)`);
        } else {
          cantApply(`Substitute ${line} → ${m.newName || '?'}`, m.newName ? `couldn’t estimate macros for “${m.newName}”` : 'no replacement specified', m.newName);
        }
      } else {
        cantApply(`${m.type} ${m.target || ''}`.trim(), `“${m.target || 'that ingredient'}” isn’t in this recipe`);
      }
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
      const sub = findLibraryIngredient(m.newName, labelByName, library);
      if (sub) {
        const unit = m.unit === 'oz' ? 'oz' : (m.unit === 'g' ? 'g' : cur.unit);
        const amount = m.quantity != null && Number(m.quantity) > 0 ? String(m.quantity) : cur.amount;
        // Slots are weight-based; libraryMacrosFor also rejects a per-unit
        // ingredient here, which macrosForLabelServingAmount would silently
        // mis-scale (treating "200 g" as 200 units).
        if (libraryMacrosFor(sub, amount, unit)) {
          resolvedBySlot[slot.slot_id] = { label_ingredient_id: Number(sub.id), amount, unit };
          customizations[slot.slot_id] = { label_ingredient_id: Number(sub.id), amount, unit };
          const asked = normName(m.newName) === normName(sub.name) ? '' : ` (matched “${m.newName}”)`;
          applied.push(`Substituted ${name} → ${sub.name}${asked}`);
          if (!(slot.option_label_ingredient_ids || []).map(Number).includes(Number(sub.id))) {
            keepable.push({
              kind: 'option', slotId: slot.slot_id, ingredientId: Number(sub.id),
              label: `Offer ${sub.name} as a swap for ${name}`,
            });
          }
        } else if (m.newName && hasMacroEstimate(m)) {
          // Saved, but not usable at this amount/unit — keep the swap via the
          // AI estimate rather than dropping it.
          resolvedBySlot[slot.slot_id] = { ...cur, amount: '0' };
          addedRows.push({
            name: sub.name, amount: m.quantity != null ? Number(m.quantity) : Number(cur.amount), unit: m.unit || cur.unit,
            calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
            source: 'ai',
          });
          applied.push(`Substituted ${name} → ${sub.name} (AI estimate — saved macros don’t cover this amount)`);
        } else {
          cantApply(`Substitute ${name} → ${sub.name}`, `“${sub.name}” needs nutrition info (grams per serving) before it can be used`, sub.name);
        }
      } else if (m.newName && hasMacroEstimate(m)) {
        // Non-library substitute with an AI estimate → drop the original slot and
        // add the substitute as an AI-estimated row (routes through the custom path).
        resolvedBySlot[slot.slot_id] = { ...cur, amount: '0' };
        addedRows.push({
          name: m.newName, amount: m.quantity != null ? Number(m.quantity) : Number(cur.amount), unit: m.unit || cur.unit,
          calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
          source: 'ai',
        });
        applied.push(`Substituted ${name} → ${m.newName} (AI estimate)`);
      } else {
        cantApply(`Substitute ${name} → ${m.newName || '?'}`, m.newName ? `couldn’t estimate macros for “${m.newName}”` : 'no replacement specified', m.newName);
      }
    }
  }

  return {
    customizations, resolvedBySlot, servingsScale, applied, unapplied, addedRows, droppedLines, keepable,
    // Extra rows have no slot to live in, and a dropped template line can't be
    // expressed as a slot customization — both need the custom-log path.
    requiresCustomPath: addedRows.length > 0 || droppedLines.size > 0,
  };
}

/**
 * Replace one modification with a hand-resolved version: the exact saved
 * ingredient the user picked, at the amount they confirmed. Re-running
 * applyModifications over the result applies it through the normal library
 * path, so a manual fix and an AI-matched swap produce identical logs.
 */
export function resolveModification(modifications, modIndex, ingredient, quantity, unit) {
  const list = Array.isArray(modifications) ? [...modifications] : [];
  const m = list[modIndex];
  if (!m || !ingredient?.name) return list;
  const q = Number(quantity);
  list[modIndex] = {
    ...m,
    newName: ingredient.name,
    quantity: Number.isFinite(q) && q > 0 ? q : null,
    unit: unit || m.unit || '',
  };
  return list;
}

/**
 * Per-ingredient preview rows after applying the resolved selections (display
 * only — the logged rows come from the server's recipe-log resolution). Removed
 * (amount<=0) slots are dropped; manual name-only lines render without macros
 * unless they were removed/swapped out (`droppedLines`).
 */
export function resolvedReviewRows(recipe, labelById, resolvedBySlot, droppedLines) {
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
      source: 'library',
      label_ingredient_id: res.label_ingredient_id != null ? Number(res.label_ingredient_id) : undefined,
    });
  }
  for (const line of listNonEditableTemplateLines(recipe)) {
    if (droppedLines?.has?.(line.name)) continue;
    rows.push({ name: line.name, amountText: line.amount, calories: null, protein_g: null, carbs_g: null, fat_g: null, source: 'recipe' });
  }
  return rows;
}
