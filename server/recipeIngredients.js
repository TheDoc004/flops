/**
 * Recipe `ingredients` JSON: named library-backed lines (+ optional free-text lines).
 * Legacy `kind: 'slot'` rows migrate to `kind: 'ingredient'` (default option only).
 */

const { amountInBasisUnit, canonicalUnit, loggableUnitsFor } = require('./unitConvert');

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
 * Recipe-line units keep whatever unit was chosen — a recipe can hold "200 ml"
 * or "1 filet" — but fold to the canonical spelling so "Cups" and "cup" are not
 * two different units to the conversion layer.
 */
function normalizeUnit(raw) {
  return canonicalUnit(raw) || 'g';
}

/** Convert a legacy slot (or virtual slot) into a named ingredient line. */
function slotToIngredientLine(slot) {
  const ids = Array.isArray(slot.option_label_ingredient_ids)
    ? slot.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];
  const label_ingredient_id = ids[0];
  if (!label_ingredient_id) return null;
  const amount = String(slot.amount ?? '').trim();
  if (!amount) return null;
  return {
    kind: 'ingredient',
    name: String(slot.label || '').trim() || `Ingredient #${label_ingredient_id}`,
    amount,
    unit: normalizeUnit(slot.unit),
    label_ingredient_id,
  };
}

/**
 * Named library-backed lines for seeding Log Meal + micros.
 * Migrates legacy slots and meal_builder_meta virtual lines on the fly.
 */
function listRecipeIngredientLines(recipeRow) {
  const ingredients = parseIngredientsJson(recipeRow?.ingredients);
  const meta = parseMealBuilderMetaFromRow(recipeRow);
  const metaLines = meta && Array.isArray(meta.lines) ? meta.lines : [];
  const out = [];

  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (!item) continue;

    if (item.kind === 'ingredient') {
      out.push(item);
      continue;
    }

    if (item.kind === 'slot') {
      const migrated = slotToIngredientLine(item);
      if (migrated) out.push(migrated);
      continue;
    }

    if (item.kind !== 'line') continue;
    const ml = metaLines[i];
    if (!ml || ml.label_ingredient_id == null) continue;
    const lid = Number(ml.label_ingredient_id);
    if (!Number.isInteger(lid) || lid <= 0) continue;
    let amountStr = ml.amount != null && String(ml.amount).trim() !== '' ? String(ml.amount).trim() : '';
    let unit = ml.unit === 'oz' ? 'oz' : (ml.unit || 'g');
    if (!amountStr || Number(amountStr) <= 0) {
      const fb = tryParseLineAmountForVirtual(item);
      if (fb) {
        amountStr = fb.amount;
        unit = fb.unit;
      }
    }
    if (!amountStr || Number(amountStr) <= 0) continue;
    out.push({
      kind: 'ingredient',
      name: String(item.name || ml.name || '').trim() || `Ingredient #${lid}`,
      amount: amountStr,
      unit,
      label_ingredient_id: lid,
    });
  }
  return out;
}

/**
 * @deprecated Prefer listRecipeIngredientLines. Kept for dual-read of old logs /
 * AI command paths that still key off slot_id.
 */
function listLoggingSlotsFromRecipeRow(recipeRow) {
  const lines = listRecipeIngredientLines(recipeRow);
  return lines.map((line, i) => ({
    kind: 'slot',
    slot_id: `ing_${line.label_ingredient_id}_${i}`,
    label: line.name,
    amount: String(line.amount),
    unit: line.unit === 'oz' ? 'oz' : (line.unit || 'g'),
    option_label_ingredient_ids: [line.label_ingredient_id],
  }));
}

function parseIngredientsJson(raw) {
  if (raw == null || raw === '') return [];
  let arr;
  if (Array.isArray(raw)) {
    arr = raw;
  } else {
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(v)) return [];
      arr = v;
    } catch {
      return [];
    }
  }
  return arr
    .filter(item => item && typeof item === 'object')
    .map(item => {
      if (item.kind === 'ingredient' || (item.label_ingredient_id != null && item.kind !== 'slot' && item.kind !== 'line')) {
        const label_ingredient_id = Number(item.label_ingredient_id);
        const name = String(item.name ?? item.label ?? '').trim();
        const amount = String(item.amount ?? '').trim();
        if (!Number.isInteger(label_ingredient_id) || label_ingredient_id <= 0 || !name || !amount) return null;
        return {
          kind: 'ingredient',
          name,
          amount,
          unit: normalizeUnit(item.unit),
          label_ingredient_id,
        };
      }
      if (item.kind === 'slot') {
        // Lazy-migrate: keep only the default option as a named ingredient.
        return slotToIngredientLine({
          label: item.label,
          amount: item.amount,
          unit: item.unit,
          option_label_ingredient_ids: Array.isArray(item.option_label_ingredient_ids)
            ? item.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
            : [],
        });
      }
      const name = String(item.name ?? '').trim();
      const amount = String(item.amount ?? '').trim();
      if (!name || !amount) return null;
      return { kind: 'line', name, amount };
    })
    .filter(Boolean);
}

/**
 * Normalize ingredients on create/update. Accepts ingredient + line;
 * legacy slots are converted to ingredients (default id only).
 */
function normalizeIngredientsBody(body) {
  const { ingredients } = body;
  if (ingredients === undefined || ingredients === null) return { ok: true, value: [] };
  if (!Array.isArray(ingredients)) return { ok: false };
  const value = [];
  for (const item of ingredients) {
    if (item == null || typeof item !== 'object') continue;
    if (item.kind === 'slot') {
      const migrated = slotToIngredientLine({
        label: item.label || item.name,
        amount: item.amount,
        unit: item.unit,
        option_label_ingredient_ids: Array.isArray(item.option_label_ingredient_ids)
          ? [...new Set(item.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
          : [],
      });
      if (!migrated) return { ok: false };
      value.push(migrated);
      continue;
    }
    if (item.kind === 'ingredient' || (item.label_ingredient_id != null && item.kind !== 'line')) {
      const label_ingredient_id = Number(item.label_ingredient_id);
      const name = String(item.name ?? item.label ?? '').trim();
      const amount = String(item.amount ?? '').trim();
      const unit = normalizeUnit(item.unit);
      if (!Number.isInteger(label_ingredient_id) || label_ingredient_id <= 0 || !name || !amount) {
        return { ok: false };
      }
      value.push({ kind: 'ingredient', name, amount, unit, label_ingredient_id });
      continue;
    }
    const name = String(item.name ?? '').trim();
    const amount = String(item.amount ?? '').trim();
    if (name && amount) value.push({ kind: 'line', name, amount });
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
  // Keep whatever unit was chosen — the ingredient decides whether it is usable
  // (see ingredientMacrosForAmount). Collapsing everything to g/oz here is what
  // made a per-cup or per-filet ingredient impossible to log in another unit.
  const unit = canonicalUnit(raw.unit) || 'g';
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
    unit: canonicalUnit(templateUnit) || 'g',
  };
}

function resolveSlotsForLog(db, recipeRow, slot_selections, log_slot_customizations, existingSlotJson, recipeChanged, userId) {
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
    let unit = canonicalUnit(s.unit) || 'g';

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

    if (!checkLi.get(label_ingredient_id, userId)) {
      const err = new Error('LABEL_INGREDIENT_NOT_FOUND');
      err.code = 'LABEL_INGREDIENT_NOT_FOUND';
      throw err;
    }
    // Only the number is checked here — whether the UNIT works is a question
    // about the ingredient, answered in ingredientMacrosForAmount below.
    if (!Number.isFinite(Number(String(amountStr ?? '').trim())) || Number(amountStr) < 0) {
      const err = new Error('INVALID_SLOT_AMOUNT');
      err.code = 'INVALID_SLOT_AMOUNT';
      throw err;
    }
    resolved[s.slot_id] = { label_ingredient_id, amount: amountStr, unit };
  }
  return resolved;
}

/**
 * The unit a logged row is shown in. Whatever unit the amount was actually
 * entered in wins — log a per-cup milk in millilitres and the receipt says
 * "200 ml", not "0.85 cup" — as long as the ingredient can be measured that
 * way. Anything else falls back to the ingredient's own unit.
 */
function displayUnitForIngredient(ingRow, amountUnit) {
  const chosen = canonicalUnit(amountUnit);
  if (chosen && loggableUnitsFor(ingRow).includes(chosen)) return chosen;
  if (ingRow?.tracking_type === 'unit') {
    return String(ingRow.unit_name || '').trim() || 'unit';
  }
  return chosen === 'oz' ? 'oz' : 'g';
}

/**
 * How many of the ingredient's stored servings an amount comes to, or null when
 * the ingredient cannot be measured in that unit. The amount is restated in the
 * ingredient's OWN serving unit first, so a per-cup item accepts ml, fl oz,
 * tbsp — and grams once its gram equivalent is recorded.
 *
 * Mirrors servingsForAmount in client/src/features/label-ocr/labelMacro.js.
 */
function servingsForIngredientAmount(ingRow, amountValue, unit) {
  if (!ingRow) return null;
  const inBasis = amountInBasisUnit(ingRow, amountValue, unit);
  if (inBasis == null) return null;
  const perServing = ingRow.tracking_type === 'unit'
    ? Number(ingRow.serving_quantity)
    : Number(ingRow.grams_per_serving);
  if (Number.isFinite(perServing) && perServing > 0) return inBasis / perServing;
  // A count defaults to one per serving; a grams-per-serving item never guesses.
  return ingRow.tracking_type === 'unit' ? inBasis : null;
}

function ingredientMacrosForAmount(ingRow, amountValue, unit) {
  const mult = servingsForIngredientAmount(ingRow, amountValue, unit);
  if (mult == null) return null;
  return {
    calories: Number(ingRow.calories) * mult,
    protein_g: Number(ingRow.protein_g) * mult,
    carbs_g: Number(ingRow.carbs_g) * mult,
    fat_g: Number(ingRow.fat_g) * mult,
    fiber_g: ingRow.fiber_g != null && ingRow.fiber_g !== '' ? Number(ingRow.fiber_g) * mult : 0,
  };
}

/**
 * Why ingredientMacrosForAmount refused, so the caller can say something the
 * user can act on: record a gram equivalent, or pick a different unit.
 */
function amountFailureCode(ingRow, unit) {
  const units = loggableUnitsFor(ingRow);
  if (units.length === 0) return 'LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING';
  return units.includes(canonicalUnit(unit))
    ? 'LABEL_INGREDIENT_NEEDS_GRAMS_PER_SERVING'
    : 'LABEL_INGREDIENT_UNIT_NOT_CONVERTIBLE';
}

function r2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Sum macros from client/server receipt rows (already scaled).
 * Returns null if no usable macro fields exist.
 */
function macrosFromReceiptRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const tot = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  let any = false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const c = Number(r.calories);
    const p = Number(r.protein_g);
    const cb = Number(r.carbs_g);
    const f = Number(r.fat_g);
    if (![c, p, cb, f].every(Number.isFinite)) continue;
    any = true;
    tot.calories += c;
    tot.protein_g += p;
    tot.carbs_g += cb;
    tot.fat_g += f;
    const fib = Number(r.fiber_g);
    if (Number.isFinite(fib)) tot.fiber_g += fib;
  }
  if (!any) return null;
  return {
    calories: r2(tot.calories),
    protein_g: r2(tot.protein_g),
    carbs_g: r2(tot.carbs_g),
    fat_g: r2(tot.fat_g),
    fiber_g: r2(tot.fiber_g),
  };
}

/**
 * Build receipt rows + per-serving macros from a freeform ingredients payload.
 * Recomputes from the library when label_ingredient_id is present; otherwise
 * trusts client macros on the row.
 */
function resolveReceiptForLog(db, rawRows, userId) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    const err = new Error('EMPTY_RECEIPT');
    err.code = 'EMPTY_RECEIPT';
    throw err;
  }
  const getIng = id =>
    db.prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, userId);
  const rows = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const lid = Number(r.label_ingredient_id);
    const hasLid = Number.isInteger(lid) && lid > 0;
    const amount = r.amount != null && r.amount !== '' && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null;
    if (amount != null && amount <= 0) continue;

    if (hasLid) {
      const ing = getIng(lid);
      if (!ing) {
        const err = new Error('LABEL_INGREDIENT_NOT_FOUND');
        err.code = 'LABEL_INGREDIENT_NOT_FOUND';
        throw err;
      }
      // The unit is taken as given. Forcing a weight-tracked row to 'g' used to
      // silently read "200 ml" as 200 grams.
      const amountUnit = canonicalUnit(r.unit) || 'g';
      const amountVal = amount != null ? amount : Number(r.amount);
      if (!Number.isFinite(amountVal) || amountVal <= 0) continue;
      const m = ingredientMacrosForAmount(ing, amountVal, amountUnit);
      if (!m) {
        const code = amountFailureCode(ing, amountUnit);
        const err = new Error(code);
        err.code = code;
        err.ingredientName = ing.name;
        err.unit = amountUnit;
        throw err;
      }
      rows.push({
        name: ing.name || name,
        amount: amountVal,
        unit: displayUnitForIngredient(ing, amountUnit),
        calories: r2(m.calories),
        protein_g: r2(m.protein_g),
        carbs_g: r2(m.carbs_g),
        fat_g: r2(m.fat_g),
        fiber_g: r2(m.fiber_g),
        source: 'library',
        label_ingredient_id: lid,
      });
      continue;
    }

    const num = v => (Number.isFinite(Number(v)) ? r2(v) : null);
    const calories = num(r.calories);
    const protein_g = num(r.protein_g);
    const carbs_g = num(r.carbs_g);
    const fat_g = num(r.fat_g);
    if (calories == null || protein_g == null || carbs_g == null || fat_g == null) continue;
    const row = {
      name,
      amount,
      unit: typeof r.unit === 'string' ? r.unit : '',
      calories,
      protein_g,
      carbs_g,
      fat_g,
      source: ['provided', 'library', 'ai', 'recipe', 'common', 'manual'].includes(r.source) ? r.source : 'estimated',
    };
    if (r.fiber_g != null) row.fiber_g = num(r.fiber_g);
    rows.push(row);
    if (rows.length >= 60) break;
  }
  if (rows.length === 0) {
    const err = new Error('EMPTY_RECEIPT');
    err.code = 'EMPTY_RECEIPT';
    throw err;
  }
  const perServing = macrosFromReceiptRows(rows);
  if (!perServing) {
    const err = new Error('EMPTY_RECEIPT');
    err.code = 'EMPTY_RECEIPT';
    throw err;
  }
  return { rows, perServing };
}

function adjustPerServingMacrosForResolvedSlots(db, recipeRow, resolvedBySlot, userId) {
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
    db.prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, userId);

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
    const mDef = ingredientMacrosForAmount(defIng, slot.amount, slot.unit);
    const mSel = ingredientMacrosForAmount(selIng, res.amount, res.unit);
    if (!mDef || !mSel) {
      const bad = !mDef ? { ing: defIng, unit: slot.unit } : { ing: selIng, unit: res.unit };
      const code = amountFailureCode(bad.ing, bad.unit);
      const err = new Error(code);
      err.code = code;
      err.ingredientName = bad.ing && bad.ing.name;
      err.unit = canonicalUnit(bad.unit);
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

function resolvedIngredientRows(db, recipeRow, resolvedBySlot, userId) {
  const slots = listLoggingSlotsFromRecipeRow(recipeRow);
  if (slots.length === 0) return [];
  const getIng = id =>
    db.prepare('SELECT * FROM label_ingredients WHERE id = ? AND user_id = ?').get(id, userId);
  const rows = [];
  for (const slot of slots) {
    const res =
      (resolvedBySlot && resolvedBySlot[slot.slot_id]) || {
        label_ingredient_id: slot.option_label_ingredient_ids[0],
        amount: slot.amount,
        unit: canonicalUnit(slot.unit) || 'g',
      };
    const amount = Number(res.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const ing = getIng(res.label_ingredient_id);
    const m = ingredientMacrosForAmount(ing, res.amount, res.unit);
    if (!m) continue;
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

function listVariableSlotsFromRecipeRow(recipeRow) {
  return listLoggingSlotsFromRecipeRow(recipeRow);
}

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
  adjustPerServingMacrosForResolvedSlots,
  resolvedIngredientRows,
  resolveSlotsForLog,
  listVariableSlotsFromRecipeRow,
  listLoggingSlotsFromRecipeRow,
  listRecipeIngredientLines,
  mergeSlotSelections,
  gramsFromAmount,
  displayUnitForIngredient,
  ingredientMacrosForAmount,
  servingsForIngredientAmount,
  amountFailureCode,
  macrosFromReceiptRows,
  resolveReceiptForLog,
};
