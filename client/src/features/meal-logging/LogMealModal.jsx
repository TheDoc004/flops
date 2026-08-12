import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import RecipeCombobox from '@shared/ui/RecipeCombobox';
import { adjustPerServingMacrosForResolvedClient } from './recipeLogMacros';
import { macrosForLabelServingAmount } from '@features/label-ocr';
import { listLoggingSlotsFromRecipe, listNonEditableTemplateLines } from './recipeLoggingSlots';
import { amountsDifferFromRecipe } from './recipeAmountUpdate';

function lastSubsKey(recipeId) { return `nlog_lastSubs_${recipeId}`; }
function lastAmountsKey(recipeId) { return `nlog_lastAmounts_${recipeId}`; }

function loadLastSubs(recipeId) {
  try {
    const raw = localStorage.getItem(lastSubsKey(recipeId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLastSubs(recipeId, subs) {
  try { localStorage.setItem(lastSubsKey(recipeId), JSON.stringify(subs)); } catch { /* storage may be unavailable */ }
}

/**
 * Amounts work like substitutions: the portion you last logged for a slot is
 * what comes back next time, so bumping blueberries to 100g sticks without
 * touching the saved recipe. Stored per recipe, and only ever a starting
 * value — the field stays editable.
 */
function loadLastAmounts(recipeId) {
  try {
    const raw = localStorage.getItem(lastAmountsKey(recipeId));
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' ? p : {};
  } catch { return {}; }
}

function saveLastAmounts(recipeId, amounts) {
  try { localStorage.setItem(lastAmountsKey(recipeId), JSON.stringify(amounts)); } catch { /* storage may be unavailable */ }
}

/** A remembered amount is only usable if it still parses as a real portion. */
function validRememberedAmount(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const n = Number(saved.amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { amount: String(n), unit: saved.unit === 'oz' ? 'oz' : 'g' };
}

/**
 * One name per ingredient row. The slot's own label is what the recipe calls
 * this line ("Eggs", "Oil spray"), so it wins; the library ingredient name and
 * brand only fill in when the slot has no label of its own. The full library
 * name still rides along as the row's title text.
 */
function ingredientRowName(slotLabel, ing, fallbackId) {
  const label = String(slotLabel || '').trim();
  if (label) return label;
  if (ing?.name) return ing.name;
  return `Ingredient #${fallbackId}`;
}

function ingredientFullName(ing, fallbackId) {
  if (!ing?.name) return `Ingredient #${fallbackId}`;
  return `${ing.name}${ing.brand_name ? ` (${ing.brand_name})` : ''}`;
}

function parseHHMMToTimeMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export default function LogMealModal({ onLog, onClose, initialEntry, title, submitLabel, onOpenAi }) {
  const ref = useRef(null);
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState(initialEntry?.recipe_id ? String(initialEntry.recipe_id) : '');
  const [servings, setServings] = useState(
    initialEntry?.servings != null ? String(initialEntry.servings) : '1'
  );
  const [notes, setNotes] = useState(initialEntry?.notes ? String(initialEntry.notes) : '');
  const [timeHHMM, setTimeHHMM] = useState(() => {
    if (initialEntry?.time_min == null) return '';
    const t = Number(initialEntry.time_min);
    if (!Number.isFinite(t) || t < 0 || t > 1439) return '';
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    return `${h}:${m}`;
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [labelIngredients, setLabelIngredients] = useState([]);
  const [slotSelections, setSlotSelections] = useState({});
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [slotLogAmounts, setSlotLogAmounts] = useState({});
  /* Logging a bare ingredient — almonds, a banana — without wrapping it in a
     recipe or spending an AI call. Only offered when creating: editing an
     existing entry into a different food is the editor's job, not this modal's.
     `pickKind` says which of the two ids below the picker is pointing at. */
  const allowIngredients = !initialEntry;
  const [pickKind, setPickKind] = useState('recipe');
  const [ingredientId, setIngredientId] = useState('');
  const [ingAmount, setIngAmount] = useState('');
  const [ingUnit, setIngUnit] = useState('g');
  const prevRecipeIdRef = useRef(null);
  const recipeComboboxRef = useRef(null);

  const selectedRecipe = useMemo(
    () => recipes.find(r => String(r.id) === String(recipeId)) || null,
    [recipes, recipeId]
  );

  const variableSlots = useMemo(
    () => listLoggingSlotsFromRecipe(selectedRecipe),
    [selectedRecipe]
  );

  const templateLinesOnlyManual = useMemo(
    () => listNonEditableTemplateLines(selectedRecipe),
    [selectedRecipe]
  );

  const slotsNeedingChoice = useMemo(
    () => variableSlots.filter(s => (s.option_label_ingredient_ids?.length || 0) > 1),
    [variableSlots]
  );

  const labelById = useMemo(
    () => Object.fromEntries(labelIngredients.map(x => [String(x.id), x])),
    [labelIngredients]
  );

  const selectedIngredient = useMemo(
    () => (pickKind === 'ingredient' ? labelById[String(ingredientId)] || null : null),
    [labelById, ingredientId, pickKind]
  );

  /* Unit-tracked ingredients are counted in their own unit ("3 eggs"), so an
     oz/g switch would be meaningless for them. */
  const ingredientIsUnitTracked = selectedIngredient?.tracking_type === 'unit';
  const ingredientUnitName = ingredientIsUnitTracked
    ? (selectedIngredient.unit_name || 'serving')
    : ingUnit;

  const ingredientPreview = useMemo(
    () => (selectedIngredient
      ? macrosForLabelServingAmount(selectedIngredient, ingAmount, ingredientUnitName)
      : null),
    [selectedIngredient, ingAmount, ingredientUnitName]
  );

  /* Picking from the combobox. Selecting an ingredient seeds the amount with one
     of whatever its label calls a serving, so the common case ("one banana",
     "one scoop") needs no typing. Done here rather than in an effect — the
     selection is an event, and this repo's lint bans setState in effect bodies. */
  function handlePick(nextId, kind) {
    setPickKind(kind);
    if (kind === 'recipe') {
      setIngredientId('');
      setRecipeId(nextId);
      return;
    }
    setRecipeId('');
    setIngredientId(nextId);
    const ing = labelById[String(nextId)];
    if (!ing) return;
    if (ing.tracking_type === 'unit') {
      setIngAmount(String(ing.serving_quantity ?? 1));
      return;
    }
    setIngUnit('g');
    const gps = Number(ing.grams_per_serving);
    setIngAmount(Number.isFinite(gps) && gps > 0 ? String(gps) : '');
  }

  // Reset per-slot state when recipe changes
  useEffect(() => {
    if (prevRecipeIdRef.current != null && prevRecipeIdRef.current !== recipeId) {
      setSlotLogAmounts({});
      setSlotSelections({});
    }
    prevRecipeIdRef.current = recipeId;
  }, [recipeId]);

  // Auto-expand ingredient section whenever a recipe with variable slots is selected
  useEffect(() => {
    setCustomizeOpen(selectedRecipe != null && variableSlots.length > 0);
  }, [selectedRecipe?.id, variableSlots.length]);

  // Auto-focus the recipe input when the modal opens
  useEffect(() => {
    requestAnimationFrame(() => recipeComboboxRef.current?.focus());
  }, []);

  // Initialize per-slot amounts: last-used first, then the recipe's own amount
  // (preserves existing state on re-render). Editing an existing log ignores
  // the memory — that entry's own amounts load below and must win.
  useEffect(() => {
    if (!selectedRecipe) {
      setSlotLogAmounts({});
      return;
    }
    const slots = listLoggingSlotsFromRecipe(selectedRecipe);
    if (slots.length === 0) {
      setSlotLogAmounts({});
      return;
    }
    const remembered = (initialEntry || !selectedRecipe.id) ? {} : loadLastAmounts(selectedRecipe.id);
    setSlotLogAmounts(prev => {
      const next = {};
      for (const s of slots) {
        const keep = prev[s.slot_id];
        const last = validRememberedAmount(remembered[s.slot_id]);
        next[s.slot_id] = {
          amount: keep?.amount != null ? String(keep.amount) : String(last?.amount ?? s.amount),
          unit: keep?.unit === 'oz' || keep?.unit === 'g'
            ? keep.unit
            : (last?.unit ?? (s.unit === 'oz' ? 'oz' : 'g')),
        };
      }
      return next;
    });
  }, [recipeId, selectedRecipe?.id, initialEntry?.id]);

  // Load saved customizations from an existing log entry (edit mode)
  useEffect(() => {
    if (!initialEntry?.slot_selections_json || !selectedRecipe?.id) return;
    try {
      const p = JSON.parse(initialEntry.slot_selections_json);
      if (!p || typeof p !== 'object') return;
      const slots = listLoggingSlotsFromRecipe(selectedRecipe);
      const selPatch = {};
      const amtPatch = {};
      let ok = false;
      for (const s of slots) {
        const raw = p[s.slot_id];
        if (raw != null && typeof raw === 'object' && raw.label_ingredient_id != null) {
          selPatch[s.slot_id] = Number(raw.label_ingredient_id);
          amtPatch[s.slot_id] = {
            amount: String(raw.amount != null ? raw.amount : s.amount),
            unit: raw.unit === 'oz' ? 'oz' : 'g',
          };
          ok = true;
        } else if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
          selPatch[s.slot_id] = raw;
          ok = true;
        }
      }
      if (ok) {
        setSlotSelections(prev => ({ ...prev, ...selPatch }));
        setSlotLogAmounts(prev => ({ ...prev, ...amtPatch }));
      }
    } catch {
      /* ignore */
    }
  }, [initialEntry?.id, initialEntry?.slot_selections_json, selectedRecipe?.id]);

  useEffect(() => {
    (async () => {
      try {
        setLabelIngredients(await fetchLabelIngredients());
      } catch {
        setLabelIngredients([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchRecipes();
        if (initialEntry?.recipe_id && !list.some(r => String(r.id) === String(initialEntry.recipe_id))) {
          try {
            const r = await fetchRecipe(initialEntry.recipe_id);
            setRecipes([r, ...list]);
          } catch {
            setRecipes(list);
          }
        } else {
          setRecipes(list);
        }
      } catch {
        setError('Failed to load recipes');
      }
    })();
    ref.current?.showModal();
  }, []);

  // Initialize substitute slot selections from last-used or recipe defaults
  useEffect(() => {
    if (!selectedRecipe) return;
    if (slotsNeedingChoice.length === 0) {
      setSlotSelections({});
      return;
    }
    let fromEntry = {};
    if (initialEntry?.slot_selections_json) {
      try {
        fromEntry = JSON.parse(initialEntry.slot_selections_json);
        if (!fromEntry || typeof fromEntry !== 'object') fromEntry = {};
      } catch { fromEntry = {}; }
    }
    const lastUsed = selectedRecipe?.id ? loadLastSubs(selectedRecipe.id) : {};
    const next = {};
    for (const s of slotsNeedingChoice) {
      const v = fromEntry[s.slot_id];
      // Handle both new format {label_ingredient_id, ...} and old format (plain number)
      const ingId = typeof v === 'object' && v?.label_ingredient_id != null
        ? Number(v.label_ingredient_id)
        : (typeof v === 'number' ? v : null);
      if (ingId != null && Number.isInteger(ingId) && ingId > 0 && s.option_label_ingredient_ids.includes(ingId)) {
        next[s.slot_id] = ingId;
      } else {
        const lastId = Number(lastUsed[s.slot_id]);
        if (Number.isInteger(lastId) && lastId > 0 && s.option_label_ingredient_ids.includes(lastId)) {
          next[s.slot_id] = lastId;
        } else {
          next[s.slot_id] = s.option_label_ingredient_ids[0];
        }
      }
    }
    setSlotSelections(next);
  }, [selectedRecipe, slotsNeedingChoice, initialEntry?.id, initialEntry?.slot_selections_json]);

  // Macro preview using current slot selections + amounts
  const slotResolved = useMemo(() => {
    if (!selectedRecipe || variableSlots.length === 0) return null;
    const built = {};
    for (const s of variableSlots) {
      const defId = s.option_label_ingredient_ids[0];
      const hasChoices = (s.option_label_ingredient_ids?.length || 0) > 1;
      const selId = hasChoices ? (slotSelections[s.slot_id] ?? defId) : defId;
      const amt = slotLogAmounts[s.slot_id];
      built[s.slot_id] = {
        label_ingredient_id: selId,
        amount: amt?.amount != null ? String(amt.amount) : String(s.amount),
        unit: amt?.unit === 'oz' ? 'oz' : 'g',
      };
    }
    return adjustPerServingMacrosForResolvedClient(selectedRecipe, labelById, built);
  }, [selectedRecipe, variableSlots, slotSelections, slotLogAmounts, labelById]);

  // Does this log use portions the recipe itself doesn't? Gates the one
  // "Use recipe amounts" reset at the top of the list.
  const amountsChanged = useMemo(
    () => amountsDifferFromRecipe(variableSlots, slotLogAmounts, labelById),
    [variableSlots, slotLogAmounts, labelById]
  );

  function setSlotAmount(slot, patch) {
    setSlotLogAmounts(prev => {
      const cur = prev[slot.slot_id];
      return {
        ...prev,
        [slot.slot_id]: {
          amount: patch.amount != null ? patch.amount : (cur?.amount ?? String(slot.amount)),
          unit: patch.unit != null ? patch.unit : (cur?.unit ?? (slot.unit === 'oz' ? 'oz' : 'g')),
        },
      };
    });
  }

  /** Put every slot back to the recipe's own portion in one go. */
  function resetAllSlotAmounts() {
    setSlotLogAmounts(() => {
      const next = {};
      for (const s of variableSlots) {
        next[s.slot_id] = { amount: String(s.amount), unit: s.unit === 'oz' ? 'oz' : 'g' };
      }
      return next;
    });
  }

  function buildLogSlotCustomizationsPayload() {
    if (variableSlots.length === 0) return null;
    const out = {};
    for (const s of variableSlots) {
      const defId = s.option_label_ingredient_ids[0];
      const hasChoices = (s.option_label_ingredient_ids?.length || 0) > 1;
      const selId = hasChoices ? (slotSelections[s.slot_id] ?? defId) : defId;
      const amt = slotLogAmounts[s.slot_id];
      out[s.slot_id] = {
        label_ingredient_id: selId,
        amount: amt?.amount != null ? String(amt.amount) : String(s.amount),
        unit: amt?.unit === 'oz' ? 'oz' : 'g',
      };
    }
    return out;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return; // guard against double-submit (rapid clicks / Enter)
    setError('');
    try {
      /* An ingredient log is a one-off food, not a recipe log: it goes out as a
         `custom` payload the caller sends to /api/log/custom. The single
         ingredient row rides along so the entry keeps its breakdown AND so the
         server can read this ingredient's stored label micros instead of paying
         for an AI estimate. */
      if (pickKind === 'ingredient') {
        if (!selectedIngredient) return setError('Select an ingredient');
        const amount = Number(ingAmount);
        if (!Number.isFinite(amount) || amount <= 0) return setError('Enter an amount');
        if (!ingredientPreview) {
          return setError(
            `${selectedIngredient.name} needs grams per serving before it can be logged by weight. Edit it in the Ingredient Library.`
          );
        }
        const macros = {
          calories: ingredientPreview.calories,
          protein_g: ingredientPreview.protein_g,
          carbs_g: ingredientPreview.carbs_g,
          fat_g: ingredientPreview.fat_g,
          fiber_g: ingredientPreview.fiber_g,
        };
        setSubmitting(true);
        await onLog({
          custom: {
            name: selectedIngredient.name,
            ...macros,
            servings: 1,
            notes: notes.trim() || undefined,
            time_min: parseHHMMToTimeMin(timeHHMM),
            ingredients: [{
              label_ingredient_id: Number(selectedIngredient.id),
              name: selectedIngredient.name,
              amount,
              unit: ingredientUnitName,
              source: 'library',
              ...macros,
            }],
          },
        });
        ref.current?.close();
        onClose();
        return;
      }

      if (!recipeId) return setError('Select a recipe');
      const payload = {
        recipe_id: Number(recipeId),
        servings: Number(servings),
        notes: notes.trim() || undefined,
        time_min: parseHHMMToTimeMin(timeHHMM),
      };
      if (variableSlots.length > 0) {
        for (const s of slotsNeedingChoice) {
          if (slotSelections[s.slot_id] == null) {
            return setError(`Choose an option for: ${s.label || 'ingredient slot'}`);
          }
        }
        payload.log_slot_customizations = buildLogSlotCustomizationsPayload();
      }
      setSubmitting(true);
      await onLog(payload);
      if (slotsNeedingChoice.length > 0 && recipeId) {
        const toSave = {};
        for (const s of slotsNeedingChoice) {
          const chosenId = slotSelections[s.slot_id];
          if (chosenId != null) toSave[s.slot_id] = Number(chosenId);
        }
        if (Object.keys(toSave).length > 0) saveLastSubs(Number(recipeId), toSave);
      }
      // Remember the portions used, so the next log of this recipe starts here.
      if (variableSlots.length > 0 && recipeId) {
        const amounts = {};
        for (const s of variableSlots) {
          const amt = slotLogAmounts[s.slot_id];
          const n = Number(amt?.amount);
          if (Number.isFinite(n) && n > 0) {
            amounts[s.slot_id] = { amount: String(n), unit: amt?.unit === 'oz' ? 'oz' : 'g' };
          }
        }
        if (Object.keys(amounts).length > 0) saveLastAmounts(Number(recipeId), amounts);
      }
      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
      setSubmitting(false); // re-enable so the user can retry
    }
  }

  function close() { if (submitting) return; ref.current?.close(); onClose(); }

  return (
    <dialog ref={ref} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{title || 'Log a Meal'}</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>✕</button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* One-off meals live in the AI logger now — this modal logs saved recipes.
            On the dashboard, onOpenAi hands off to the AI popup in place (no
            navigation); elsewhere we fall back to the full /ai-logger page. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {onOpenAi ? (
            <button
              type="button"
              className="btn-ai"
              onClick={() => { close(); onOpenAi(); }}
              style={{ minHeight: 48, padding: '0 20px', fontSize: '1rem' }}
            >
              <span className="spark" aria-hidden="true">✨</span> AI Estimate — describe or speak a meal
            </button>
          ) : (
            <Link
              to="/ai-logger"
              className="btn-ai"
              onClick={close}
              style={{ minHeight: 48, padding: '0 20px', fontSize: '1rem' }}
            >
              <span className="spark" aria-hidden="true">✨</span> AI Estimate — describe or speak a meal
            </Link>
          )}
        </div>

        {/* Meal Builder shortcut */}
        <div>
          <Link
            to="/meal-builder"
            onClick={close}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: '#4b5563',
              textDecoration: 'none',
              padding: '7px 14px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              background: 'white',
            }}
          >
            Open Meal Builder →
          </Link>
        </div>

        <div className="panel-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Recipe picker */}
            <div>
              <RecipeCombobox
                ref={recipeComboboxRef}
                label={allowIngredients ? 'Recipe or ingredient' : 'Recipe'}
                recipes={recipes}
                ingredients={allowIngredients ? labelIngredients : []}
                value={pickKind === 'ingredient' ? ingredientId : recipeId}
                valueKind={pickKind}
                onChange={handlePick}
                placeholder={allowIngredients ? 'Search a meal or a single food…' : 'Search recipe or meal…'}
              />
              {selectedRecipe && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Selected: <strong style={{ color: 'var(--color-text-strong)' }}>{selectedRecipe.name}</strong> · per {selectedRecipe.serving_size}
                </p>
              )}
            </div>

            {/* Amount — for a single ingredient this replaces Servings, because
                what you know is "30 g of almonds", not "0.75 servings". */}
            {selectedIngredient ? (
              <div>
                <label htmlFor="log-ing-amount">
                  Amount{ingredientIsUnitTracked ? ` (${ingredientUnitName})` : ''}
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    id="log-ing-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={ingAmount}
                    onChange={e => setIngAmount(e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                    required
                  />
                  {ingredientIsUnitTracked ? (
                    <span style={{ fontSize: 14, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {ingredientUnitName}
                    </span>
                  ) : (
                    <select
                      value={ingUnit}
                      onChange={e => setIngUnit(e.target.value)}
                      aria-label="Unit"
                      style={{ width: 'auto', flexShrink: 0 }}
                    >
                      <option value="g">g</option>
                      <option value="oz">oz</option>
                    </select>
                  )}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {ingredientPreview ? (
                    <>
                      ≈ <strong style={{ color: 'var(--color-text-strong)' }}>{Math.round(ingredientPreview.calories)} cal</strong>
                      {' · '}{Math.round(ingredientPreview.protein_g)}p
                      {' · '}{Math.round(ingredientPreview.carbs_g)}c
                      {' · '}{Math.round(ingredientPreview.fat_g)}f
                    </>
                  ) : (
                    <>Needs grams per serving — edit {selectedIngredient.name} in the Ingredient Library.</>
                  )}
                </p>
              </div>
            ) : (
              <div>
                <label>Servings</label>
                <input type="number" min="0.25" step="0.25" value={servings} onChange={e => setServings(e.target.value)} required />
              </div>
            )}

            {/* Customize ingredients toggle */}
            {selectedRecipe && variableSlots.length > 0 && (
              <div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCustomizeOpen(v => !v)}
                >
                  {customizeOpen ? 'Hide ingredient details ↑' : 'Customize ingredients…'}
                </button>
              </div>
            )}

            {/* Inline customize section — unified for all recipes with variable slots */}
            {customizeOpen && selectedRecipe && variableSlots.length > 0 && (
              <div className="panel-in" style={{ padding: 10, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb' }}>
                {/* One reset for the whole list, up here where it doesn't
                    interrupt the rows you're reading. */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 28, marginBottom: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Customize this log</p>
                  {amountsChanged && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={resetAllSlotAmounts}
                      style={{ minHeight: 0, padding: '5px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      Use recipe amounts
                    </button>
                  )}
                </div>

                {/* Fixed (manual text) rows that can't be edited — one line, not a list */}
                {templateLinesOnlyManual.length > 0 && (
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#4b5563' }}>
                    <strong>Fixed:</strong>{' '}
                    {templateLinesOnlyManual.map(ln => `${ln.name} — ${ln.amount}`).join(' · ')}
                  </p>
                )}

                <div className="slot-list">
                  <div className="slot-list__head" aria-hidden="true">
                    <span>Ingredient</span>
                    <span>Amount</span>
                    <span>Unit</span>
                  </div>
                  {variableSlots.map(slot => {
                    const hasChoices = (slot.option_label_ingredient_ids?.length || 0) > 1;
                    const defId = slot.option_label_ingredient_ids[0];
                    const resolvedIngId = hasChoices ? (slotSelections[slot.slot_id] ?? defId) : defId;
                    const resolvedIng = labelById[String(resolvedIngId)];
                    const amt = slotLogAmounts[slot.slot_id];
                    const slotIsUnit = resolvedIng?.tracking_type === 'unit';
                    const slotUnitLabel = resolvedIng?.unit_name || 'unit';
                    const slotName = ingredientRowName(slot.label, resolvedIng, defId);
                    return (
                      <div key={slot.slot_id} className="slot-row">
                        {hasChoices ? (
                          <div className="slot-row__name">
                            <select
                              aria-label={`Ingredient for ${slotName}`}
                              value={String(slotSelections[slot.slot_id] ?? defId ?? '')}
                              onChange={e =>
                                setSlotSelections(prev => ({ ...prev, [slot.slot_id]: Number(e.target.value) }))
                              }
                            >
                              {slot.option_label_ingredient_ids.map(oid => {
                                const li = labelById[String(oid)];
                                const isDef = oid === defId;
                                return (
                                  <option key={oid} value={oid}>
                                    {li ? `${li.name}${li.brand_name ? ` (${li.brand_name})` : ''}` : `Ingredient #${oid}`}
                                    {isDef ? ' — default' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        ) : (
                          <div className="slot-row__name" title={ingredientFullName(resolvedIng, defId)}>
                            {slotName}
                          </div>
                        )}

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Amount for ${slotName}`}
                          value={amt?.amount ?? String(slot.amount)}
                          onChange={e => setSlotAmount(slot, { amount: e.target.value })}
                        />

                        {slotIsUnit ? (
                          <div className="slot-row__unit-static">{slotUnitLabel}</div>
                        ) : (
                          <select
                            aria-label={`Unit for ${slotName}`}
                            value={amt?.unit ?? (slot.unit === 'oz' ? 'oz' : 'g')}
                            onChange={e => setSlotAmount(slot, { unit: e.target.value === 'oz' ? 'oz' : 'g' })}
                          >
                            <option value="g">g</option>
                            <option value="oz">oz</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Macro preview */}
                {slotResolved && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '7px 10px',
                      borderRadius: 8,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      fontSize: 12,
                      color: '#1e3a8a',
                    }}
                  >
                    <strong>Per serving:</strong>{' '}
                    {Math.round(slotResolved.calories)} cal · P {slotResolved.protein_g.toFixed(1)}g · C{' '}
                    {slotResolved.carbs_g.toFixed(1)}g · F {slotResolved.fat_g.toFixed(1)}g
                    {slotResolved.fiber_g > 0 && ` · Fiber ${slotResolved.fiber_g.toFixed(1)}g`}
                    {' — '}
                    <span style={{ color: '#64748b' }}>
                      this log ({Number(servings) || 1} serving{Number(servings) === 1 ? '' : 's'}):{' '}
                      <strong style={{ color: '#0f172a' }}>
                        {Math.round(slotResolved.calories * (Number(servings) || 1))} cal
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

        {/* Time + notes share a row: both are optional, and stacking them just
            pushes the Log button further down the modal. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <label>Time (optional)</label>
            <input
              type="time"
              value={timeHHMM}
              onChange={e => setTimeHHMM(e.target.value)}
            />
          </div>
          <div>
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. post-workout" />
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        <div style={{ marginTop: 4 }}>
          <button
            type="submit"
            className={submitting ? 'btn-primary btn-loading' : 'btn-primary'}
            disabled={submitting}
            style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
          >
            {submitting ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>) : (submitLabel || 'Log Meal')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
