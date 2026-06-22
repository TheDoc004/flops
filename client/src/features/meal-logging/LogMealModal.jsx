import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import RecipeCombobox from '@shared/ui/RecipeCombobox';
import { QUICK_FOODS, filterQuickFoods, macrosForQuickFoodAmount } from './quickFoods';
import { adjustPerServingMacrosForResolvedClient } from './recipeLogMacros';
import { listLoggingSlotsFromRecipe, listNonEditableTemplateLines } from './recipeLoggingSlots';

function preventOptionMouseDown(e) {
  e.preventDefault();
}

function lastSubsKey(recipeId) { return `nlog_lastSubs_${recipeId}`; }

function loadLastSubs(recipeId) {
  try {
    const raw = localStorage.getItem(lastSubsKey(recipeId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLastSubs(recipeId, subs) {
  try { localStorage.setItem(lastSubsKey(recipeId), JSON.stringify(subs)); } catch { /* storage may be unavailable */ }
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

export default function LogMealModal({ onLog, onClose, initialEntry, title, submitLabel }) {
  const ref = useRef(null);
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState(initialEntry?.recipe_id ? String(initialEntry.recipe_id) : '');
  const [mode, setMode] = useState('recipe'); // 'recipe' | 'quick' | 'custom'
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
  const [labelIngredients, setLabelIngredients] = useState([]);
  const [slotSelections, setSlotSelections] = useState({});
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [slotLogAmounts, setSlotLogAmounts] = useState({});
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

  // Auto-focus recipe input when modal is in recipe mode
  useEffect(() => {
    if (mode !== 'recipe') return;
    requestAnimationFrame(() => recipeComboboxRef.current?.focus());
  }, [mode]);

  // Initialize per-slot amounts from recipe defaults (preserves existing state on re-render)
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
    setSlotLogAmounts(prev => {
      const next = {};
      for (const s of slots) {
        const keep = prev[s.slot_id];
        next[s.slot_id] = {
          amount: keep?.amount != null ? String(keep.amount) : String(s.amount),
          unit: keep?.unit === 'oz' || keep?.unit === 'g' ? keep.unit : s.unit === 'oz' ? 'oz' : 'g',
        };
      }
      return next;
    });
  }, [recipeId, selectedRecipe?.id]);

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

  // Quick add state
  const [quickQuery, setQuickQuery] = useState('');
  const [quickFoodId, setQuickFoodId] = useState('');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickUnit, setQuickUnit] = useState('g');
  const quickOptions = useMemo(() => filterQuickFoods(quickQuery), [quickQuery]);
  const quickSelected = useMemo(() => QUICK_FOODS.find(f => f.id === quickFoodId) || null, [quickFoodId]);
  const quickMacros = useMemo(() => macrosForQuickFoodAmount(quickSelected, quickAmount, quickUnit), [quickSelected, quickAmount, quickUnit]);

  // Custom "log once" state — for meals whose macros you already know (e.g. worked out elsewhere).
  const [customName, setCustomName] = useState('');
  const [customCalories, setCustomCalories] = useState('');
  const [customProtein, setCustomProtein] = useState('');
  const [customCarbs, setCustomCarbs] = useState('');
  const [customFat, setCustomFat] = useState('');
  const [customFiber, setCustomFiber] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'quick') {
        if (!quickSelected) return setError('Select a food');
        if (!quickMacros) return setError('Enter an amount in grams or ounces');
        await onLog({
          quick_food: {
            name: quickSelected.name,
            amount: Number(quickAmount),
            unit: quickUnit,
            calories_100g: quickSelected.calories_100g,
            protein_g_100g: quickSelected.protein_g_100g,
            carbs_g_100g: quickSelected.carbs_g_100g,
            fat_g_100g: quickSelected.fat_g_100g,
          },
          notes: notes.trim() || undefined,
          time_min: parseHHMMToTimeMin(timeHHMM),
        });
      } else if (mode === 'custom') {
        const name = customName.trim();
        if (!name) return setError('Enter a meal name');
        const cals = Number(customCalories);
        const p = Number(customProtein);
        const c = Number(customCarbs);
        const f = Number(customFat);
        if ([cals, p, c, f].some(n => !Number.isFinite(n) || n < 0)) {
          return setError('Enter calories, protein, carbs and fat (0 or more)');
        }
        const fiber = customFiber.trim() === '' ? undefined : Number(customFiber);
        if (fiber !== undefined && (!Number.isFinite(fiber) || fiber < 0)) {
          return setError('Fiber must be 0 or more, or left blank');
        }
        await onLog({
          log_custom: {
            name,
            calories: cals,
            protein_g: p,
            carbs_g: c,
            fat_g: f,
            ...(fiber !== undefined ? { fiber_g: fiber } : {}),
          },
          notes: notes.trim() || undefined,
          time_min: parseHHMMToTimeMin(timeHHMM),
        });
      } else {
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
        await onLog(payload);
        if (slotsNeedingChoice.length > 0 && recipeId) {
          const toSave = {};
          for (const s of slotsNeedingChoice) {
            const chosenId = slotSelections[s.slot_id];
            if (chosenId != null) toSave[s.slot_id] = Number(chosenId);
          }
          if (Object.keys(toSave).length > 0) saveLastSubs(Number(recipeId), toSave);
        }
      }
      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  function close() { ref.current?.close(); onClose(); }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>{title || 'Log a Meal'}</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={mode === 'recipe' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('recipe')}
            style={{ minHeight: 48, padding: '0 20px', fontSize: '1rem', fontWeight: 700 }}
          >
            Saved recipe
          </button>
          <button
            type="button"
            className={mode === 'quick' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('quick')}
            style={{ minHeight: 48, padding: '0 20px', fontSize: '1rem', fontWeight: 700 }}
          >
            Quick add food
          </button>
          <button
            type="button"
            className={mode === 'custom' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('custom')}
            style={{ minHeight: 48, padding: '0 20px', fontSize: '1rem', fontWeight: 700 }}
          >
            Log once (custom)
          </button>
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
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--color-text-faint)' }}>Build a new recipe first</span>
        </div>

        {mode === 'recipe' ? (
          <>
            {/* Recipe picker */}
            <div>
              <RecipeCombobox
                ref={recipeComboboxRef}
                label="Recipe"
                recipes={recipes}
                value={recipeId}
                onChange={(next) => setRecipeId(next)}
                placeholder="Search recipe or meal…"
              />
              {selectedRecipe && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Selected: <strong style={{ color: 'var(--color-text-strong)' }}>{selectedRecipe.name}</strong> · per {selectedRecipe.serving_size}
                </p>
              )}
            </div>

            {/* Servings */}
            <div>
              <label>Servings</label>
              <input type="number" min="0.25" step="0.25" value={servings} onChange={e => setServings(e.target.value)} required />
            </div>

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
              <div style={{ padding: 14, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Customize this log</p>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Changes only apply to this meal log. Your saved recipe stays the same.
                </p>

                {/* Fixed (manual text) rows that can't be edited */}
                {templateLinesOnlyManual.length > 0 && (
                  <div style={{ marginBottom: 14, padding: 10, background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#4b5563' }}>
                    <strong>Fixed items (not editable):</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {templateLinesOnlyManual.map((ln, i) => (
                        <li key={`${ln.name}-${i}`}>{ln.name} — {ln.amount}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {variableSlots.map(slot => {
                    const hasChoices = (slot.option_label_ingredient_ids?.length || 0) > 1;
                    const defId = slot.option_label_ingredient_ids[0];
                    const resolvedIngId = hasChoices ? (slotSelections[slot.slot_id] ?? defId) : defId;
                    const resolvedIng = labelById[String(resolvedIngId)];
                    const amt = slotLogAmounts[slot.slot_id];
                    const slotIsUnit = resolvedIng?.tracking_type === 'unit';
                    const slotUnitLabel = resolvedIng?.unit_name || 'unit';
                    return (
                      <div
                        key={slot.slot_id}
                        style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: 'white' }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-strong)' }}>
                          {slot.label || 'Ingredient slot'}
                        </div>

                        {hasChoices ? (
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12 }}>Ingredient</label>
                            <select
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
                          <div style={{ marginBottom: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Ingredient</span>
                            <div style={{ fontSize: 13, color: 'var(--color-text-body)' }}>
                              {resolvedIng?.name || `#${defId}`}
                              {resolvedIng?.brand_name ? ` (${resolvedIng.brand_name})` : ''}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 12 }}>Amount</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={amt?.amount ?? String(slot.amount)}
                              onChange={e =>
                                setSlotLogAmounts(prev => ({
                                  ...prev,
                                  [slot.slot_id]: {
                                    amount: e.target.value,
                                    unit: prev[slot.slot_id]?.unit ?? (slot.unit === 'oz' ? 'oz' : 'g'),
                                  },
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 12 }}>Unit</label>
                            {slotIsUnit ? (
                              <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--color-text-body)' }}>
                                {slotUnitLabel}
                              </div>
                            ) : (
                              <select
                                value={amt?.unit ?? (slot.unit === 'oz' ? 'oz' : 'g')}
                                onChange={e =>
                                  setSlotLogAmounts(prev => ({
                                    ...prev,
                                    [slot.slot_id]: {
                                      amount: prev[slot.slot_id]?.amount ?? String(slot.amount),
                                      unit: e.target.value === 'oz' ? 'oz' : 'g',
                                    },
                                  }))
                                }
                              >
                                <option value="g">g</option>
                                <option value="oz">oz</option>
                              </select>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Macro preview */}
                {slotResolved && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 10,
                      borderRadius: 8,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      fontSize: 12,
                      color: '#1e3a8a',
                    }}
                  >
                    <strong>Adjusted recipe (per serving):</strong>{' '}
                    {Math.round(slotResolved.calories)} cal · P {slotResolved.protein_g.toFixed(1)}g · C{' '}
                    {slotResolved.carbs_g.toFixed(1)}g · F {slotResolved.fat_g.toFixed(1)}g
                    {slotResolved.fiber_g > 0 && ` · Fiber ${slotResolved.fiber_g.toFixed(1)}g`}
                    <span style={{ color: '#64748b', display: 'block', marginTop: 6 }}>
                      This log ({Number(servings) || 1} serving{Number(servings) === 1 ? '' : 's'}):{' '}
                      <strong style={{ color: '#0f172a' }}>
                        {Math.round(slotResolved.calories * (Number(servings) || 1))} cal
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        ) : mode === 'quick' ? (
          /* Quick add mode */
          <div>
            <label>Food</label>
            <input
              type="search"
              placeholder="Search foods…"
              value={quickQuery}
              onChange={e => { setQuickQuery(e.target.value); }}
              autoComplete="off"
            />
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              {quickOptions.length === 0 ? (
                <p className="empty-state" style={{ padding: 12 }}>No foods match &quot;{quickQuery.trim()}&quot;.</p>
              ) : (
                quickOptions.slice(0, 30).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onMouseDown={preventOptionMouseDown}
                    onClick={() => setQuickFoodId(f.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      background: f.id === quickFoodId ? '#eff6ff' : 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <strong>{f.name}</strong>
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      per 100 g · {f.calories_100g} cal
                    </span>
                  </button>
                ))
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginTop: 10 }}>
              <div>
                <label>Amount</label>
                <input type="number" min="0.01" step="0.01" value={quickAmount} onChange={e => setQuickAmount(e.target.value)} placeholder="e.g. 120" required />
              </div>
              <div>
                <label>Unit</label>
                <select value={quickUnit} onChange={e => setQuickUnit(e.target.value)}>
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                </select>
              </div>
            </div>
            {quickSelected && quickMacros && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-body)' }}>
                  <strong>{quickSelected.name}</strong> · {Math.round(quickMacros.calories)} cal ·
                  {' '}P {quickMacros.protein_g.toFixed(1)}g · C {quickMacros.carbs_g.toFixed(1)}g · F {quickMacros.fat_g.toFixed(1)}g
                </p>
              </div>
            )}
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              Quick add foods are one-off logs. They won&apos;t show up in the Recipe Library unless you save a recipe separately.
            </p>
          </div>
        ) : (
          /* Custom "log once" mode */
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-body)' }}>
              Track this meal today without saving it to your recipe library. Enter the macros you already worked out.
            </p>
            <div style={{ marginBottom: 10 }}>
              <label>Meal name</label>
              <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Chicken burrito bowl" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label>Calories</label>
                <input type="number" min="0" step="1" value={customCalories} onChange={e => setCustomCalories(e.target.value)} placeholder="e.g. 620" />
              </div>
              <div>
                <label>Protein (g)</label>
                <input type="number" min="0" step="0.1" value={customProtein} onChange={e => setCustomProtein(e.target.value)} placeholder="e.g. 45" />
              </div>
              <div>
                <label>Carbs (g)</label>
                <input type="number" min="0" step="0.1" value={customCarbs} onChange={e => setCustomCarbs(e.target.value)} placeholder="e.g. 60" />
              </div>
              <div>
                <label>Fat (g)</label>
                <input type="number" min="0" step="0.1" value={customFat} onChange={e => setCustomFat(e.target.value)} placeholder="e.g. 20" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label>Fiber (g) <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
                <input type="number" min="0" step="0.1" value={customFiber} onChange={e => setCustomFiber(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              This won&apos;t be added to your Recipe Library. To reuse a meal, build it in the Meal Builder and choose &ldquo;Save as recipe&rdquo;.
            </p>
          </div>
        )}

        {/* Time */}
        <div>
          <label>Time (optional)</label>
          <input
            type="time"
            value={timeHHMM}
            onChange={e => setTimeHHMM(e.target.value)}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Optional. Useful if you want meal order on your log to match real life.
          </p>
        </div>

        {/* Notes */}
        <div>
          <label>Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. post-workout" />
        </div>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
          >
            {submitLabel || 'Log Meal'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            style={{ width: '100%' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
