import { listRecipeIngredientLines, listNonEditableTemplateLines } from '@features/meal-logging/recipeReceipt';
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
  for (const line of listRecipeIngredientLines(recipe)) {
    const ing = line.label_ingredient_id != null && labelById ? labelById.get(Number(line.label_ingredient_id)) : null;
    push((ing && ing.name) || line.name);
  }
  for (const tline of listNonEditableTemplateLines(recipe)) push(tline.name);
  return out;
}

function lineDisplayName(line, labelById) {
  const ing = line.label_ingredient_id != null && labelById ? labelById.get(Number(line.label_ingredient_id)) : null;
  return (ing && ing.name) || line.name;
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

/** A library-backed row for the receipt (carries the id, so label micros apply). */
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

function pickUnit(requested, fallback) {
  if (requested === 'oz') return 'oz';
  if (requested === 'g') return 'g';
  return fallback;
}

/**
 * Apply AI-detected modifications to a recipe's library lines, producing the
 * receipt rows needed to log a customized instance through POST /api/log.
 *
 * Returns:
 *   - resolvedLines: every library line after changes (removed lines have amount 0).
 *   - servingsScale: number|null (whole-recipe scale, e.g. 0.5 for half).
 *   - droppedLines: Set of non-editable template line names replaced/removed here.
 *   - keepable: new library ingredients that could be saved onto the recipe.
 *   - applied: string[] summaries; unapplied: [{text, reason, modIndex, fix?}].
 *   - requiresCustomPath: true when extra AI/library rows or dropped template
 *     lines mean the log must send a full receipt (not recipe defaults).
 */
export function applyModifications(recipe, modifications, labelById, labelByName) {
  const libraryLines = listRecipeIngredientLines(recipe);
  const library = libraryFrom(labelById, labelByName);
  const resolvedLines = libraryLines.map((line, i) => ({
    key: `line_${i}`,
    label_ingredient_id: line.label_ingredient_id,
    name: line.name,
    amount: String(line.amount),
    unit: line.unit || 'g',
  }));

  const lineByName = new Map();
  for (const line of resolvedLines) {
    lineByName.set(normName(line.name), line);
    lineByName.set(normName(lineDisplayName(line, labelById)), line);
  }
  const findResolved = target => {
    if (!target) return null;
    const t = normName(target);
    if (lineByName.has(t)) return lineByName.get(t);
    for (const [name, line] of lineByName) if (name.includes(t) || t.includes(name)) return line;
    return null;
  };

  const lineNames = listNonEditableTemplateLines(recipe).map(l => String(l.name || '')).filter(Boolean);
  const findTemplateLine = target => {
    if (!target) return null;
    const t = normName(target);
    return lineNames.find(nm => normName(nm) === t)
      || lineNames.find(nm => normName(nm).includes(t) || t.includes(normName(nm)))
      || null;
  };

  const applied = [];
  const unapplied = [];
  const addedRows = [];
  const droppedLines = new Set();
  const keepable = [];
  let servingsScale = null;

  const mods = Array.isArray(modifications) ? modifications : [];
  for (let modIndex = 0; modIndex < mods.length; modIndex++) {
    const m = mods[modIndex];
    const cantApply = (text, reason, wanted) => {
      unapplied.push({
        text, reason, modIndex,
        ...(wanted ? { fix: { kind: m.type, name: wanted, quantity: m.quantity ?? null, unit: m.unit || '' } } : {}),
      });
    };
    if (m.type === 'scale') {
      const sc = Number(m.scale) > 0 ? Number(m.scale) : (Number(m.quantity) > 0 ? Number(m.quantity) : null);
      if (sc != null) {
        servingsScale = sc;
        applied.push(`Scale to ${sc}× of the recipe`);
      }
      continue;
    }
    if (m.type === 'add') {
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
    const line = findResolved(m.target);
    if (!line) {
      const tline = findTemplateLine(m.target);
      if (tline && m.type === 'remove') {
        droppedLines.add(tline);
        applied.push(`Removed ${tline}`);
      } else if (tline && m.type === 'substitute') {
        const lib = findLibraryIngredient(m.newName, labelByName, library);
        const row = lib ? libraryRow(lib, ...amountFor(lib, m.quantity, m.unit)) : null;
        if (row) {
          droppedLines.add(tline);
          addedRows.push(row);
          applied.push(`Substituted ${tline} → ${row.name} (from your library)`);
        } else if (m.newName && hasMacroEstimate(m)) {
          droppedLines.add(tline);
          addedRows.push({
            name: m.newName, amount: m.quantity != null ? Number(m.quantity) : null, unit: m.unit || '',
            calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
            source: 'ai',
          });
          applied.push(`Substituted ${tline} → ${m.newName} (AI estimate)`);
        } else {
          cantApply(`Substitute ${tline} → ${m.newName || '?'}`, m.newName ? `couldn’t estimate macros for “${m.newName}”` : 'no replacement specified', m.newName);
        }
      } else {
        cantApply(`${m.type} ${m.target || ''}`.trim(), `“${m.target || 'that ingredient'}” isn’t in this recipe`);
      }
      continue;
    }
    const name = lineDisplayName(line, labelById);

    if (m.type === 'remove' || (m.type === 'set_amount' && Number(m.quantity) <= 0)) {
      line.amount = '0';
      applied.push(`Removed ${name}`);
    } else if (m.type === 'set_amount') {
      const unit = pickUnit(m.unit, line.unit);
      line.amount = String(m.quantity);
      line.unit = unit;
      applied.push(`Set ${name} to ${line.amount} ${unit}`);
    } else if (m.type === 'substitute') {
      const sub = findLibraryIngredient(m.newName, labelByName, library);
      if (sub) {
        const unit = pickUnit(m.unit, line.unit);
        const amount = m.quantity != null && Number(m.quantity) > 0 ? String(m.quantity) : line.amount;
        if (libraryMacrosFor(sub, amount, unit)) {
          line.label_ingredient_id = Number(sub.id);
          line.amount = amount;
          line.unit = unit;
          const asked = normName(m.newName) === normName(sub.name) ? '' : ` (matched “${m.newName}”)`;
          applied.push(`Substituted ${name} → ${sub.name}${asked}`);
        } else if (m.newName && hasMacroEstimate(m)) {
          const prevAmount = Number(line.amount);
          line.amount = '0';
          addedRows.push({
            name: sub.name, amount: m.quantity != null ? Number(m.quantity) : prevAmount, unit: m.unit || line.unit,
            calories: macroNum(m.calories), protein_g: macroNum(m.protein), carbs_g: macroNum(m.carbs), fat_g: macroNum(m.fat),
            source: 'ai',
          });
          applied.push(`Substituted ${name} → ${sub.name} (AI estimate — saved macros don’t cover this amount)`);
        } else {
          cantApply(`Substitute ${name} → ${sub.name}`, `“${sub.name}” needs nutrition info (grams per serving) before it can be used`, sub.name);
        }
      } else if (m.newName && hasMacroEstimate(m)) {
        const prevAmount = Number(line.amount);
        line.amount = '0';
        addedRows.push({
          name: m.newName, amount: m.quantity != null ? Number(m.quantity) : prevAmount, unit: m.unit || line.unit,
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
    resolvedLines, servingsScale, applied, unapplied, addedRows, droppedLines, keepable,
    requiresCustomPath: addedRows.length > 0 || droppedLines.size > 0,
  };
}

/**
 * Follow-up corrections return a partial modification list. Keep earlier
 * swaps/amounts as the baseline and append the new ones (don't replace blindly).
 */
export function mergeRecipeModifications(prev, next) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  if (!a.length) return b;
  if (!b.length) return a;
  return [...a, ...b];
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
 * Per-ingredient preview rows after applying the resolved library lines.
 * Removed (amount<=0) lines are dropped; manual name-only lines render without
 * macros unless they were removed/swapped out (`droppedLines`).
 */
export function resolvedReviewRows(recipe, labelById, resolvedLines, droppedLines) {
  const rows = [];
  for (const line of resolvedLines || []) {
    const amt = Number(line.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const ing = line.label_ingredient_id != null && labelById ? labelById.get(Number(line.label_ingredient_id)) : null;
    const m = ing ? macrosForLabelServingAmount(ing, line.amount, line.unit) : null;
    rows.push({
      name: (ing && ing.name) || line.name,
      amount: amt,
      unit: line.unit,
      calories: m ? m.calories : null,
      protein_g: m ? m.protein_g : null,
      carbs_g: m ? m.carbs_g : null,
      fat_g: m ? m.fat_g : null,
      source: 'library',
      label_ingredient_id: line.label_ingredient_id != null ? Number(line.label_ingredient_id) : undefined,
    });
  }
  for (const tline of listNonEditableTemplateLines(recipe)) {
    if (droppedLines?.has?.(tline.name)) continue;
    rows.push({ name: tline.name, amountText: tline.amount, calories: null, protein_g: null, carbs_g: null, fat_g: null, source: 'recipe' });
  }
  return rows;
}
