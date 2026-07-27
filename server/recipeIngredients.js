/**
 * Recipe `ingredients` JSON: fixed lines + optional variable slots (Ingredient Library alternatives).
 */

const OZ_TO_G = 28.349523125;

function gramsFromAmount(amountStr, unit) {
  const v = Number(String(amountStr ?? '').trim());
  if (!Number.isFinite(v) || v < 0) return null;
  const u = String(unit || 'g').toLowerCase();
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return v * OZ_TO_G;
  return v;
}

function parseMealBuilderMetaFromRow(recipeRow) {
  const raw = recipeRow?.meal_builder_meta;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function tryParseLineAmountForVirtual(lineItem) {
  const s = String(lineItem?.amount ?? '').trim();
  const m = /^([\d.]+)\s*(g|oz)?\s*$/i.exec(s.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || 'g').toLowerCase();
  return { amount: String(n), unit: u === 'oz' ? 'oz' : 'g' };
}

/**
 * Variable slots for logging + macro math: real slots plus legacy Meal Builder
 * `line` rows backed by meal_builder_meta.lines (label_ingredient_id), in recipe order.
 */
function listLoggingSlotsFromRecipeRow(recipeRow) {
  const ingredients = parseIngredientsJson(recipeRow.ingredients);
  const meta = parseMealBuilderMetaFromRow(recipeRow);
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const out = [];
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item) continue;
    if (item.kind === 'slot') {
      out.push(item);
      continue;
    }
    if (item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (!ml || ml.label_ingredient_id == null) continue;
    const lid = Number(ml.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) continue;
    let amountStr = ml.amount != null && String(ml.amount).trim() !== '' ? String(ml.amount).trim() : '';
    let unit = ml.unit === 'oz' ? 'oz' : 'g';
    if (!amountStr || Number(amountStr) <= 0) {
      const fb = tryParseLineAmountForVirtual(item);
      if (fb) {
        amountStr = fb.amount;
        unit = fb.unit;
      }
    }
    if (!amountStr || Number(amountStr) <= 0) continue;
    const slotId =
      ml.slot_id != null && String(ml.slot_id).trim() !== ''
        ? String(ml.slot_id).trim()
        : `mb_legacy_${i}_${lid}`;
    out.push({
      kind: 'slot',
      slot_id: slotId,
      label: item.name,
      amount: amountStr,
      unit,
      option_label_ingredient_ids: [lid],
    });
  }
  return out;
}

function parseIngredientsJson(raw) {
  if (raw == null || raw === '') return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(item => item && typeof item === 'object')
      .map(item => {
        if (item.kind === 'slot') {
          const slot_id = String(item.slot_id ?? '').trim();
          const label = String(item.label ?? '').trim();
          const amount = String(item.amount ?? '').trim();
          const unit = String(item.unit ?? 'g').toLowerCase() === 'oz' ? 'oz' : 'g';
          const option_label_ingredient_ids = Array.isArray(item.option_label_ingredient_ids)
            ? item.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
            : [];
          if (!slot_id || !label || !amount || option_label_ingredient_ids.length === 0) return null;
          return {
            kind: 'slot',
            slot_id,
            label,
            amount,
            unit,
            option_label_ingredient_ids,
          };
        }
        const name = String(item.name ?? '').trim();
        const amount = String(item.amount ?? '').trim();
        if (!name || !amount) return null;
        return { kind: 'line', name, amount };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeIngredientsBody(body) {
  const { ingredients } = body;
  if (ingredients === undefined || ingredients === null) return { ok: true, value: [] };
  if (!Array.isArray(ingredients)) return { ok: false };
  const value = [];
  for (const item of ingredients) {
    if (item == null || typeof item !== 'object') continue;
    if (item.kind === 'slot') {
      const slot_id = String(item.slot_id ?? '').trim();
      const label = String(item.label ?? '').trim();
      const amount = String(item.amount ?? '').trim();
      const unit = String(item.unit ?? 'g').toLowerCase() === 'oz' ? 'oz' : 'g';
      const option_label_ingredient_ids = Array.isArray(item.option_label_ingredient_ids)
        ? [...new Set(item.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
        : [];
      if (!slot_id || !label || !amount || option_label_ingredient_ids.length === 0) {
        return { ok: false };
      }
      value.push({
        kind: 'slot',
        slot_id,
        label,
        amount,
        unit,
        option_label_ingredient_ids,
      });
    } else {
      const name = String(item.name ?? '').trim();
      const amount = String(item.amount ?? '').trim();
      if (name && amount) value.push({ kind: 'line', name, amount });
    }
  }
  return { ok: true, value };
}

function readIdFromStoredSlotValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'object' && v.label_ingredient_id != null) {
    const n = Number(v.label_ingredient_id);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function parseStoredSlotSelectionsJson(raw) {
  if (raw == null || raw === '') return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return {};
    return v;
  } catch {
    return {};
  }
}

function normalizeLogSlotCustomization(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label_ingredient_id = Number(raw.label_ingredient_id);
  if (!Number.isInteger(label_ingredient_id) || label_ingredient_id <= 0) return null;
  let amount = null;
  if (raw.amount != null && String(raw.amount).trim() !== '') {
    amount = String(raw.amount).trim();
  }
  const unit = String(raw.unit ?? 'g').toLowerCase() === 'oz' ? 'oz' : 'g';
  return { label_ingredient_id, amount, unit };
}

function slotDetailFromExisting(existingSlotJson, slot_id, templateAmount, templateUnit, mergedId) {
  const parsed = parseStoredSlotSelectionsJson(existingSlotJson);
  const raw = parsed[slot_id];
  if (raw != null && typeof raw === 'object' && raw.label_ingredient_id != null) {
    const norm = normalizeLogSlotCustomization(raw);
    if (norm) {
      return {
        label_ingredient_id: norm.label_ingredient_id,
        amount: norm.amount != null ? norm.amount : String(templateAmount),
        unit: norm.unit,
      };
    }
  }
  return {
    label_ingredient_id: mergedId,
    amount: String(templateAmount),
    unit: templateUnit === 'oz' ? 'oz' : 'g',
  };
}

/**
 * Resolves each slot to { label_ingredient_id, amount, unit } for this log instance.
 * - `log_slot_customizations` may pick any library ingredient (not limited to slot options).
 * - Amount/unit default to the recipe template unless overridden.
 */
function resolveSlotsForLog(db, recipeRow, slot_selections, log_slot_customizations, existingSlotJson, recipeChanged) {
  const slots = listLoggingSlotsFromRecipeRow(recipeRow);
  const mergedIds = mergeSlotSelections(slots, slot_selections, existingSlotJson, recipeChanged);
  const custom =
    log_slot_customizations && typeof log_slot_customizations === 'object' && !Array.isArray(log_slot_customizations)
      ? log_slot_customizations
      : null;
  const checkLi = db.prepare('SELECT id FROM label_ingredients WHERE id = ? AND user_id = ?');

  const resolved = {};
  for (const s of slots) {
    let label_ingredient_id = mergedIds[s.slot_id];
    let amountStr = String(s.amount);
    let unit = s.unit === 'oz' ? 'oz' : 'g';

    if (custom && Object.prototype.hasOwnProperty.call(custom, s.slot_id)) {
      const norm = normalizeLogSlotCustomization(custom[s.slot_id]);
      if (!norm) {
        const err = new Error('INVALID_LOG_SLOT_CUSTOMIZATION');
        err.code = 'INVALID_LOG_SLOT_CUSTOMIZATION';
        throw err;
      }
      label_ingredient_id = norm.label_ingredient_id;
      if (norm.amount != null) amountStr = norm.amount;
      unit = norm.unit;
    } else if (!recipeChanged && existingSlotJson) {
      const d = slotDetailFromExisting(existingSlotJson, s.slot_id, s.amount, s.unit, mergedIds[s.slot_id]);
      label_ingredient_id = d.label_ingredient_id;
      amountStr = d.amount;
      unit = d.unit;
    }

    if (!checkLi.get(label_ingredient_id, 0)) {
      const err = new Error('LABEL_INGREDIENT_NOT_FOUND');
      err.code = 'LABEL_INGREDIENT_NOT_FOUND';
      throw err;
    }
    if (gramsFromAmount(amountStr, unit) == null) {
      const err = new Error('INVALID_SLOT_AMOUNT');
      err.code = 'INVALID_SLOT_AMOUNT';
      throw err;
    }
    resolved[s.slot_id] = { label_ingredient_id, amount: amountStr, unit };
  }
  return resolved;
}

/**
 * The unit to SHOW for a logged line. Amounts on a unit-tracked ingredient are
 * counts, not grams — 3 eggs, 1 spray, 2 slices — so labelling them "g" (as the
 * internal g/oz amount unit does) is simply wrong on screen. Weight-tracked
 * ingredients keep their real g/oz unit.
 */
function displayUnitForIngredient(ingRow, amountUnit) {
  if (ingRow?.tracking_type === 'unit') {
    return String(ingRow.unit_name || '').trim() || 'unit';
  }
  return amountUnit === 'oz' ? 'oz' : 'g';
}

/**
 * Macros for a label-ingredient at a given amount/unit (per the ingredient's
 * own tracking type). Pure; returns null if the amount/unit can't be resolved.
 */
function ingredientMacrosForAmount(ingRow, amountValue, unit) {
  if (!ingRow) return null;
  if (ingRow.tracking_type === 'unit') {
    const count = Number(amountValue);
    if (!Number.isFinite(count) || count < 0) return null;
    const sq = Number(ingRow.serving_quantity);
    const mult = count / (Number.isFinite(sq) && sq > 0 ? sq : 1);
    return {
      calories: Number(ingRow.calories) * mult,
      protein_g: Number(ingRow.protein_g) * mult,
      carbs_g: Number(ingRow.carbs_g) * mult,
      fat_g: Number(ingRow.fat_g) * mult,
      fiber_g: ingRow.fiber_g != null && ingRow.fiber_g !== '' ? Number(ingRow.fiber_g) * mult : 0,
    };
  }
  const gps = Number(ingRow.grams_per_serving);
  if (!Number.isFinite(gps) || gps <= 0) return null;
  const grams = gramsFromAmount(amountValue, unit);
  if (grams == null) return null;
  const mult = grams / gps;
  return {
    calories: Number(ingRow.calories) * mult,
    protein_g: Number(ingRow.protein_g) * mult,
    carbs_g: Number(ingRow.carbs_g) * mult,
    fat_g: Number(ingRow.fat_g) * mult,
    fiber_g: ingRow.fiber_g != null && ingRow.fiber_g !== '' ? Number(ingRow.fiber_g) * mult : 0,
  };
}

/**
 * Per-serving macros after applying resolved slot picks (ingredient + optional amount/unit vs template).
 */
function adjustPerServingMacrosForResolvedSlots(db, recipeRow, resolvedBySlot) {
  const base = {
    calories: Number(recipeRow.calories),
    protein_g: Number(recipeRow.protein_g),
    carbs_g: Number(recipeRow.carbs_g),
    fat_g: Number(recipeRow.fat_g),
    fiber_g: recipeRow.fiber_g != null && recipeRow.fiber_g !== '' ? Number(recipeRow.fiber_g) : 0,
  };
  const slots = listLoggingSlotsFromRecipeRow(recipeRow);
  if (slots.length === 0) return base;

  const getIng = id =>
    db.prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, 0);

  const macrosForIngredientAmount = ingredientMacrosForAmount;

  let adj = { ...base };
  for (const slot of slots) {
    const res = resolvedBySlot[slot.slot_id];
    if (!res) {
      const err = new Error('INVALID_SLOT_SELECTION');
      err.code = 'INVALID_SLOT_SELECTION';
      throw err;
    }
    const defId = slot.option_label_ingredient_ids[0];
    const selId = res.label_ingredient_id;
    const defIng = getIng(defId);
    const selIng = getIng(selId);
    if (!defIng || !selIng) {
      const err = new Error('LABEL_INGREDIENT_NOT_FOUND');
      err.code = 'LABEL_INGREDIENT_NOT_FOUND';
      throw err;
    }
    const mDef = macrosForIngredientAmount(defIng, slot.amount, slot.unit);
    const mSel = macrosForIngredientAmount(selIng, res.amount, res.unit);
    if (!mDef || !mSel) {
      const err = new Error('LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING');
      err.code = 'LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING';
      throw err;
    }
    adj.calories += -mDef.calories + mSel.calories;
    adj.protein_g += -mDef.protein_g + mSel.protein_g;
    adj.carbs_g += -mDef.carbs_g + mSel.carbs_g;
    adj.fat_g += -mDef.fat_g + mSel.fat_g;
    adj.fiber_g += -mDef.fiber_g + mSel.fiber_g;
  }
  return adj;
}

/**
 * Per-ingredient breakdown rows for a recipe log (per serving), AFTER applying
 * the resolved slot picks (substitutions + edited amounts). Each macro-bearing
 * line/slot becomes one row { name, amount, unit, calories, protein_g, carbs_g,
 * fat_g, fiber_g, source:'library', label_ingredient_id }. Zeroed/removed
 * ingredients (amount <= 0) and rows whose macros can't be computed are omitted
 * so the breakdown reflects exactly what was logged. Returns [] when the recipe
 * has no macro-bearing ingredient lines (e.g. a manual name-only recipe) — the
 * caller then stores null and the entry displays as totals only.
 */
function resolvedIngredientRows(db, recipeRow, resolvedBySlot) {
  const slots = listLoggingSlotsFromRecipeRow(recipeRow);
  if (slots.length === 0) return [];
  const getIng = id =>
    db.prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, 0);
  const r2 = n => Math.round(n * 100) / 100;
  const rows = [];
  for (const slot of slots) {
    const res =
      (resolvedBySlot && resolvedBySlot[slot.slot_id]) || {
        label_ingredient_id: slot.option_label_ingredient_ids[0],
        amount: slot.amount,
        unit: slot.unit === 'oz' ? 'oz' : 'g',
      };
    const amount = Number(res.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue; // removed / zeroed
    const ing = getIng(res.label_ingredient_id);
    const m = ingredientMacrosForAmount(ing, res.amount, res.unit);
    if (!m) continue; // can't compute macros for this line — omit
    rows.push({
      name: (ing && ing.name) || slot.label,
      amount,
      unit: displayUnitForIngredient(ing, res.unit),
      calories: r2(m.calories),
      protein_g: r2(m.protein_g),
      carbs_g: r2(m.carbs_g),
      fat_g: r2(m.fat_g),
      fiber_g: r2(m.fiber_g),
      source: 'library',
      label_ingredient_id: res.label_ingredient_id,
    });
  }
  return rows;
}

/**
 * @deprecated Prefer resolveSlotsForLog + adjustPerServingMacrosForResolvedSlots.
 * Per-serving macros after swapping slot selections vs template (first option per slot), same grams as template.
 */
function adjustPerServingMacrosForSlotSelections(db, recipeRow, slotSelections) {
  const slots = listLoggingSlotsFromRecipeRow(recipeRow);
  const resolved = {};
  for (const s of slots) {
    const selId = Number(slotSelections[s.slot_id]);
    const defId = s.option_label_ingredient_ids[0];
    const id =
      Number.isInteger(selId) && selId > 0 && s.option_label_ingredient_ids.includes(selId) ? selId : defId;
    resolved[s.slot_id] = {
      label_ingredient_id: id,
      amount: String(s.amount),
      unit: s.unit === 'oz' ? 'oz' : 'g',
    };
  }
  return adjustPerServingMacrosForResolvedSlots(db, recipeRow, resolved);
}

function listVariableSlotsFromRecipeRow(recipeRow) {
  return listLoggingSlotsFromRecipeRow(recipeRow);
}

/**
 * @param {boolean} recipeChanged - if true, ignore previous log JSON (new recipe).
 */
function mergeSlotSelections(slots, bodySelections, existingSlotJson, recipeChanged) {
  let existing = {};
  if (!recipeChanged && existingSlotJson) {
    const parsed = parseStoredSlotSelectionsJson(existingSlotJson);
    for (const s of slots) {
      const id = readIdFromStoredSlotValue(parsed[s.slot_id]);
      if (id != null) existing[s.slot_id] = id;
    }
  }
  const out = {};
  for (const s of slots) {
    let v =
      bodySelections && bodySelections[s.slot_id] != null
        ? Number(bodySelections[s.slot_id])
        : existing[s.slot_id];
    if (v == null || !Number.isInteger(v) || v <= 0 || !s.option_label_ingredient_ids.includes(v)) {
      v = s.option_label_ingredient_ids[0];
    }
    out[s.slot_id] = v;
  }
  return out;
}

module.exports = {
  parseIngredientsJson,
  normalizeIngredientsBody,
  adjustPerServingMacrosForSlotSelections,
  adjustPerServingMacrosForResolvedSlots,
  resolvedIngredientRows,
  resolveSlotsForLog,
  listVariableSlotsFromRecipeRow,
  listLoggingSlotsFromRecipeRow,
  mergeSlotSelections,
  gramsFromAmount,
  displayUnitForIngredient,
};
