import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import { suggestSubstitutes } from '@shared/api/ai';
import RecipeCombobox from '@shared/ui/RecipeCombobox';
import IngredientCombobox from '@features/meal-builder/IngredientCombobox';
import { canonicalUnit, loggableUnitsFor } from '@shared/utils/unitConvert';
import { pluralizeUnit } from '@shared/utils/servingBasis';
import {
  buildReceiptLine,
  changeLineUnit,
  defaultAmountForIngredient,
  getSuggestedSubstitutes,
  loadLastReceiptAmounts,
  receiptToApiIngredients,
  refreshReceiptLine,
  retargetLineToIngredient,
  saveLastReceiptAmounts,
  seedReceiptFromRecipe,
  seedReceiptFromLoggedSelections,
  sumReceiptMacros,
} from './recipeReceipt';

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

function lineDisplayName(line) {
  if (!line?.name) return 'Ingredient';
  return line.brand_name ? `${line.name} (${line.brand_name})` : line.name;
}

export default function LogMealModal({ onLog, onClose, initialEntry, title, submitLabel }) {
  const ref = useRef(null);
  const recipeComboboxRef = useRef(null);
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
  const [receipt, setReceipt] = useState([]);
  const [addIngredientId, setAddIngredientId] = useState('');
  const [seededFromRecipeId, setSeededFromRecipeId] = useState(null);
  const [subLineId, setSubLineId] = useState(null);
  const [subSuggestions, setSubSuggestions] = useState([]);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState('');
  const [subSource, setSubSource] = useState(''); // 'ai' | 'heuristic'
  const receiptSeededRef = useRef(false);

  const selectedRecipe = useMemo(
    () => recipes.find(r => String(r.id) === String(recipeId)) || null,
    [recipes, recipeId]
  );

  const labelById = useMemo(
    () => Object.fromEntries(labelIngredients.map(x => [String(x.id), x])),
    [labelIngredients]
  );

  const receiptTotals = useMemo(() => sumReceiptMacros(receipt), [receipt]);

  useEffect(() => {
    requestAnimationFrame(() => recipeComboboxRef.current?.focus());
  }, []);

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

  // Seed receipt once labels + recipes are ready (edit mode or create).
  useEffect(() => {
    if (receiptSeededRef.current) return;
    if (labelIngredients.length === 0 && !initialEntry) return;

    if (initialEntry?.ingredients_json) {
      try {
        const rows = typeof initialEntry.ingredients_json === 'string'
          ? JSON.parse(initialEntry.ingredients_json)
          : initialEntry.ingredients_json;
        if (Array.isArray(rows) && rows.length) {
          const lines = [];
          for (const r of rows) {
            const lid = Number(r.label_ingredient_id);
            const ing = Number.isInteger(lid) && lid > 0 ? labelById[String(lid)] : null;
            if (ing) {
              const line = buildReceiptLine(ing, r.amount, r.unit || 'g', { source: r.source || 'library' });
              if (line) lines.push(line);
            } else if (r.name && r.calories != null) {
              lines.push({
                id: `legacy_${lines.length}`,
                label_ingredient_id: lid > 0 ? lid : null,
                name: r.name,
                amount: String(r.amount ?? ''),
                unit: r.unit || '',
                calories: r.calories,
                protein_g: r.protein_g,
                carbs_g: r.carbs_g,
                fat_g: r.fat_g,
                fiber_g: r.fiber_g,
                source: r.source || 'estimated',
              });
            }
          }
          if (lines.length) {
            setReceipt(lines);
            receiptSeededRef.current = true;
            if (initialEntry.recipe_id) setSeededFromRecipeId(String(initialEntry.recipe_id));
            return;
          }
        }
      } catch {
        /* fall through */
      }
    }

    if (initialEntry?.slot_selections_json && Object.keys(labelById).length > 0) {
      const lines = seedReceiptFromLoggedSelections(initialEntry.slot_selections_json, labelById);
      if (lines.length) {
        setReceipt(lines);
        receiptSeededRef.current = true;
        if (initialEntry.recipe_id) setSeededFromRecipeId(String(initialEntry.recipe_id));
        return;
      }
    }

    if (selectedRecipe && Object.keys(labelById).length > 0) {
      const remembered = initialEntry ? {} : loadLastReceiptAmounts(selectedRecipe.id);
      const lines = seedReceiptFromRecipe(selectedRecipe, labelById, remembered);
      setReceipt(lines);
      setSeededFromRecipeId(String(selectedRecipe.id));
      receiptSeededRef.current = true;
    }
  }, [selectedRecipe, labelById, labelIngredients.length, initialEntry]);

  function applyRecipeSeed(recipe) {
    if (!recipe) {
      setReceipt([]);
      setSeededFromRecipeId(null);
      return;
    }
    const remembered = loadLastReceiptAmounts(recipe.id);
    const lines = seedReceiptFromRecipe(recipe, labelById, remembered);
    setReceipt(lines);
    setSeededFromRecipeId(String(recipe.id));
    setSubLineId(null);
    setSubSuggestions([]);
  }

  function handlePick(nextId) {
    setRecipeId(nextId);
    const recipe = recipes.find(r => String(r.id) === String(nextId));
    applyRecipeSeed(recipe || null);
  }

  function handleAddIngredient(nextId) {
    setAddIngredientId('');
    const ing = labelById[String(nextId)];
    if (!ing) return;
    const def = defaultAmountForIngredient(ing);
    const line = buildReceiptLine(ing, def.amount, def.unit, { source: 'library' });
    if (!line) {
      // Say which piece is actually missing. Blaming grams per serving for
      // every failure sends the user to edit a field that is already filled in.
      const units = loggableUnitsFor(ing);
      setError(
        units.length === 0
          ? `${ing.name} needs a serving size before it can be logged. Edit it in the Ingredient Library.`
          : `${ing.name} has no amount saved for one serving. Edit it in the Ingredient Library.`
      );
      return;
    }
    setError('');
    setReceipt(prev => [...prev, line]);
  }

  // Switching a line's unit restates the amount instead of reinterpreting it:
  // 1 cup of milk becomes 236.59 ml, never 1 ml.
  function updateLineUnit(id, nextUnit) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== id) return line;
        const ing = labelById[String(line.label_ingredient_id)];
        const patch = ing ? changeLineUnit(line, ing, nextUnit) : null;
        if (!patch) return line;
        return refreshReceiptLine({ ...line, ...patch }, ing);
      })
    );
  }

  function updateLine(id, patch) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        const ing = labelById[String(next.label_ingredient_id)];
        if (ing) return refreshReceiptLine(next, ing);
        return next;
      })
    );
  }

  function removeLine(id) {
    setReceipt(prev => prev.filter(l => l.id !== id));
    if (subLineId === id) {
      setSubLineId(null);
      setSubSuggestions([]);
    }
  }

  function resetToRecipeAmounts() {
    if (!selectedRecipe) return;
    const lines = seedReceiptFromRecipe(selectedRecipe, labelById, {});
    setReceipt(lines);
    setSeededFromRecipeId(String(selectedRecipe.id));
  }

  async function openSubstitutes(line) {
    setSubLineId(line.id);
    setSubError('');
    setSubSuggestions([]);
    setSubBusy(true);
    const current = labelById[String(line.label_ingredient_id)];
    const library = labelIngredients.filter(x => Number(x.id) !== Number(line.label_ingredient_id));
    try {
      const res = await suggestSubstitutes({
        ingredient: current
          ? {
              name: current.name,
              brand_name: current.brand_name,
              base_label: current.base_label,
              tracking_type: current.tracking_type,
            }
          : { name: line.name },
        library: library.slice(0, 80).map(x => ({
          id: x.id,
          name: x.name,
          brand_name: x.brand_name,
          base_label: x.base_label,
          last_used_at: x.last_used_at,
        })),
        limit: 5,
      });
      const ids = Array.isArray(res?.suggestions)
        ? res.suggestions.map(s => Number(s.label_ingredient_id)).filter(n => Number.isInteger(n) && n > 0)
        : [];
      const byId = new Map(library.map(x => [Number(x.id), x]));
      const fromAi = ids.map(id => byId.get(id)).filter(Boolean);
      if (fromAi.length) {
        setSubSuggestions(fromAi);
        setSubSource('ai');
        setSubBusy(false);
        return;
      }
    } catch (e) {
      setSubError(e.message || 'AI substitutes unavailable. Showing similar foods from your library.');
    }
    setSubSuggestions(getSuggestedSubstitutes(current, library, { excludeId: line.label_ingredient_id, limit: 5 }));
    setSubSource('heuristic');
    setSubBusy(false);
  }

  function applySubstitute(lineId, ing) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== lineId) return line;
        const { amount, unit } = retargetLineToIngredient(line, ing);
        return refreshReceiptLine(
          { ...line, amount, unit, label_ingredient_id: Number(ing.id), source: 'library' },
          ing
        );
      })
    );
    setSubLineId(null);
    setSubSuggestions([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');

    const apiIngredients = receiptToApiIngredients(receipt);
    const time_min = parseHHMMToTimeMin(timeHHMM);
    const notesVal = notes.trim() || undefined;

    try {
      setSubmitting(true);

      // Recipe with a built receipt (library lines).
      if (recipeId && seededFromRecipeId && String(recipeId) === String(seededFromRecipeId) && apiIngredients.length > 0) {
        if (receipt.some(l => l.label_ingredient_id && l.calories == null)) {
          setSubmitting(false);
          return setError('One or more ingredients need grams per serving. Edit them in the Ingredient Library.');
        }
        const payload = {
          recipe_id: Number(recipeId),
          servings: Number(servings) || 1,
          notes: notesVal,
          time_min,
          ingredients: apiIngredients,
        };
        await onLog(payload);
        const amounts = {};
        for (const l of receipt) {
          const n = Number(l.amount);
          if (l.label_ingredient_id && Number.isFinite(n) && n > 0) {
            amounts[String(l.label_ingredient_id)] = {
              amount: String(n),
              unit: l.tracking_type === 'unit' ? 'g' : (l.unit === 'oz' ? 'oz' : 'g'),
            };
          }
        }
        if (Object.keys(amounts).length) saveLastReceiptAmounts(Number(recipeId), amounts);
      } else if (recipeId && apiIngredients.length === 0) {
        // Manual / known-macro recipe with no library lines — servings only.
        await onLog({
          recipe_id: Number(recipeId),
          servings: Number(servings) || 1,
          notes: notesVal,
          time_min,
        });
      } else if (apiIngredients.length > 0) {
        if (receipt.some(l => l.label_ingredient_id && l.calories == null)) {
          setSubmitting(false);
          return setError('One or more ingredients need grams per serving. Edit them in the Ingredient Library.');
        }
        const name = selectedRecipe?.name || apiIngredients.map(x => x.name).slice(0, 3).join(' + ') || 'Custom meal';
        const totals = sumReceiptMacros(receipt);
        await onLog({
          custom: {
            name,
            calories: Math.round((totals?.calories || 0) * 10) / 10,
            protein_g: Math.round((totals?.protein_g || 0) * 100) / 100,
            carbs_g: Math.round((totals?.carbs_g || 0) * 100) / 100,
            fat_g: Math.round((totals?.fat_g || 0) * 100) / 100,
            fiber_g: totals?.fiber_g > 0 ? Math.round(totals.fiber_g * 100) / 100 : undefined,
            servings: 1,
            notes: notesVal,
            time_min,
            ingredients: apiIngredients,
          },
        });
      } else {
        setSubmitting(false);
        return setError('Add at least one ingredient, or pick a recipe.');
      }

      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  function close() {
    if (submitting) return;
    ref.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      style={{ width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{title || 'Log a Meal'}</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <RecipeCombobox
            ref={recipeComboboxRef}
            label="Start from a recipe"
            recipes={recipes}
            value={recipeId}
            valueKind="recipe"
            onChange={handlePick}
            placeholder="Search a saved recipe…"
          />
          {selectedRecipe && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              Seeded from <strong style={{ color: 'var(--color-text-strong)' }}>{selectedRecipe.name}</strong>
              {'. Edit the receipt below; the saved recipe stays unchanged.'}
            </p>
          )}
        </div>

        {recipeId && (
          <div>
            <label>Servings</label>
            <input
              type="number"
              min="0.25"
              step="0.25"
              value={servings}
              onChange={e => setServings(e.target.value)}
              required
            />
          </div>
        )}

        <div className="panel-in modal-subpanel" style={{ padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-secondary-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 28, marginBottom: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                Receipt
              </p>
              {receipt.length > 0 && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Tap a name to swap from your library.
                </p>
              )}
            </div>
            {selectedRecipe && receipt.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetToRecipeAmounts}
                style={{ minHeight: 0, padding: '5px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                Reset to recipe
              </button>
            )}
          </div>

          {receipt.length === 0 ? (
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Pick a recipe to preload, or add foods below.
            </p>
          ) : (
            <div className="slot-list">
              <div className="slot-list__head" aria-hidden="true">
                <span>Ingredient</span>
                <span>Amount</span>
                <span>Unit</span>
                <span />
              </div>
              {receipt.map(line => {
                const lineIng = labelById[String(line.label_ingredient_id)];
                // Only units this ingredient can actually be measured in are
                // offered — see loggableUnitsFor. A line whose unit is not among
                // them (stale data) shows that unit as plain text rather than a
                // dropdown claiming some other unit is selected.
                const lineUnit = canonicalUnit(line.unit);
                const options = lineIng ? loggableUnitsFor(lineIng) : [];
                const unitOptions = options.includes(lineUnit) ? options : [];
                const unitLabel = line.unit || line.unit_name || 'unit';
                const open = subLineId === line.id;
                return (
                  <div key={line.id} className="slot-list__line">
                    <div className="slot-row">
                      <div className="slot-row__name" title={lineDisplayName(line)}>
                        <button
                          type="button"
                          onClick={() => (open ? setSubLineId(null) : openSubstitutes(line))}
                          aria-expanded={open}
                          aria-label={`Find substitutes for ${line.name}`}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            textAlign: 'left',
                            cursor: 'pointer',
                            color: 'var(--color-text-strong)',
                            font: 'inherit',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                          }}
                          title="Find substitutes from your library"
                        >
                          {line.name}
                        </button>
                        {line.calories != null && (
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                            {Math.round(line.calories)} cal · P {Number(line.protein_g).toFixed(1)} · C{' '}
                            {Number(line.carbs_g).toFixed(1)} · F {Number(line.fat_g).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Amount for ${line.name}`}
                        value={line.amount}
                        onChange={e => updateLine(line.id, { amount: e.target.value })}
                      />
                      {unitOptions.length > 1 ? (
                        <select
                          aria-label={`Unit for ${line.name}`}
                          value={lineUnit}
                          onChange={e => updateLineUnit(line.id, e.target.value)}
                        >
                          {unitOptions.map(u => (
                            <option key={u} value={u}>
                              {pluralizeUnit(u, line.amount)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="slot-row__unit-static">{unitLabel}</div>
                      )}
                      <button
                        type="button"
                        className="slot-row__remove"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => removeLine(line.id)}
                      >
                        ✕
                      </button>
                    </div>
                    {open && (
                      <div className="slot-list__subs">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <div style={{ fontWeight: 600 }}>
                            Substitutes from your library
                            {subSource === 'ai' ? ' (AI)' : subSource === 'heuristic' ? ' (similar)' : ''}
                          </div>
                          <button
                            type="button"
                            className="slot-row__remove"
                            aria-label="Close substitutes"
                            onClick={() => { setSubLineId(null); setSubSuggestions([]); }}
                          >
                            ✕
                          </button>
                        </div>
                        {subBusy && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Looking…</p>}
                        {subError && !subBusy && (
                          <p style={{ margin: '0 0 6px', color: '#92400e' }}>{subError}</p>
                        )}
                        {!subBusy && subSuggestions.length === 0 && (
                          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No close matches found.</p>
                        )}
                        {!subBusy && subSuggestions.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {subSuggestions.map(ing => (
                              <button
                                key={ing.id}
                                type="button"
                                className="btn-secondary"
                                onClick={() => applySubstitute(line.id, ing)}
                                style={{
                                  justifyContent: 'flex-start',
                                  textAlign: 'left',
                                  minHeight: 0,
                                  padding: '6px 10px',
                                  fontSize: 12,
                                }}
                              >
                                {ing.name}
                                {ing.brand_name ? ` (${ing.brand_name})` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <IngredientCombobox
              label="Add ingredient"
              items={labelIngredients}
              value={addIngredientId}
              onChange={handleAddIngredient}
              placeholder="Type to add from your library…"
              allowCreate={false}
            />
          </div>

          {receiptTotals && (
            <div
              className="modal-highlight-panel"
              style={{
                marginTop: 8,
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-primary-subtle)',
                fontSize: 12,
                color: 'var(--color-primary-ink)',
              }}
            >
              <strong>Receipt total:</strong>{' '}
              {Math.round(receiptTotals.calories)} cal · P {receiptTotals.protein_g.toFixed(1)}g · C{' '}
              {receiptTotals.carbs_g.toFixed(1)}g · F {receiptTotals.fat_g.toFixed(1)}g
              {receiptTotals.fiber_g > 0 && ` · Fiber ${receiptTotals.fiber_g.toFixed(1)}g`}
              {recipeId && Number(servings) !== 1 && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {'. This log '}({Number(servings) || 1} servings):{' '}
                  <strong style={{ color: 'var(--color-text-strong)' }}>
                    {Math.round(receiptTotals.calories * (Number(servings) || 1))} cal
                  </strong>
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <label>Time (optional)</label>
            <input type="time" value={timeHHMM} onChange={e => setTimeHHMM(e.target.value)} />
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
