import { useEffect, useMemo, useRef, useState } from 'react';
import { updateRecipe } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import IngredientCombobox from '@features/meal-builder/IngredientCombobox';
import FeaturePrompt from '@shared/ui/FeaturePrompt';
import { canonicalUnit, loggableUnitsFor } from '@shared/utils/unitConvert';
import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import {
  augmentMealPrepRecipe,
  buildReceiptLine,
  defaultAmountForIngredient,
  mealPrepContainerCount,
  refreshReceiptLine,
  sumReceiptMacros,
} from '@features/meal-logging/recipeReceipt';

function lineDisplayName(line) {
  if (!line?.name) return 'Ingredient';
  return line.brand_name ? `${line.name} (${line.brand_name})` : line.name;
}

/**
 * Add ingredients to an equal-split meal prep — batch amounts split across containers.
 */
export default function AugmentMealPrepModal({ recipe, onClose, onSaved }) {
  const ref = useRef(null);
  const { macroUnits } = useMacroUnits();
  const [labelIngredients, setLabelIngredients] = useState([]);
  const [receipt, setReceipt] = useState([]);
  const [addIngredientId, setAddIngredientId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const containerCount = mealPrepContainerCount(recipe) || Number(recipe?.max_uses) || 2;

  const labelById = useMemo(
    () => Object.fromEntries(labelIngredients.map(x => [String(x.id), x])),
    [labelIngredients]
  );

  const batchTotals = useMemo(() => sumReceiptMacros(receipt), [receipt]);
  const perServingPreview = useMemo(() => {
    if (!batchTotals || containerCount < 2) return null;
    const f = 1 / containerCount;
    return {
      calories: Math.round(batchTotals.calories * f),
      protein_g: Math.round(batchTotals.protein_g * f * 10) / 10,
      carbs_g: Math.round(batchTotals.carbs_g * f * 10) / 10,
      fat_g: Math.round(batchTotals.fat_g * f * 10) / 10,
    };
  }, [batchTotals, containerCount]);

  useEffect(() => {
    ref.current?.showModal();
  }, [recipe]);

  useEffect(() => {
    (async () => {
      try {
        setLabelIngredients(await fetchLabelIngredients());
      } catch {
        setLabelIngredients([]);
      }
    })();
  }, []);

  function addIngredient(id) {
    const ing = labelById[String(id)];
    if (!ing) return;
    const def = defaultAmountForIngredient(ing);
    const line = buildReceiptLine(ing, def.amount, def.unit, { source: 'library' });
    if (!line) return;
    setReceipt(prev => [...prev, line]);
    setAddIngredientId('');
  }

  function updateLineAmount(lineId, amount) {
    setReceipt(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const ing = labelById[String(l.label_ingredient_id)];
      return ing ? refreshReceiptLine({ ...l, amount }, ing) : { ...l, amount };
    }));
  }

  function updateLineUnit(lineId, unit) {
    setReceipt(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const ing = labelById[String(l.label_ingredient_id)];
      if (!ing || !loggableUnitsFor(ing).includes(unit)) return l;
      return refreshReceiptLine({ ...l, unit: canonicalUnit(unit) }, ing);
    }));
  }

  function removeLine(lineId) {
    setReceipt(prev => prev.filter(l => l.id !== lineId));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    const body = augmentMealPrepRecipe(recipe, receipt, { splitBy: containerCount });
    if (!body) {
      setError('Add at least one ingredient with a valid amount.');
      return;
    }
    setSaving(true);
    try {
      await updateRecipe(recipe.id, body);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not update meal prep.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} style={{ width: 'min(520px, 94vw)', maxHeight: '92vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Add to prep</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {recipe?.name} · splitting across {containerCount} containers
          </p>
        </div>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      {receipt.length === 0 && (
        <FeaturePrompt
          question="Made potato salad but forgot protein?"
          answer="Add ingredients for the whole batch here — we'll divide each evenly across your containers."
          style={{ marginBottom: 12 }}
        />
      )}

      <form onSubmit={handleSave}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ marginBottom: 4 }}>Add ingredient (whole batch)</label>
          <IngredientCombobox
            ingredients={labelIngredients}
            value={addIngredientId}
            onChange={id => { setAddIngredientId(id); if (id) addIngredient(id); }}
            placeholder="Search your library…"
          />
        </div>

        {receipt.length > 0 && (
          <div className="slot-list" style={{ marginBottom: 12 }}>
            <div className="slot-list__head" aria-hidden="true">
              <span>Ingredient</span>
              <span>Batch amt</span>
              <span>Unit</span>
              <span />
            </div>
            {receipt.map(line => {
              const lineIng = labelById[String(line.label_ingredient_id)];
              const lineUnit = canonicalUnit(line.unit);
              const unitOptions = lineIng ? loggableUnitsFor(lineIng).filter(u => u === lineUnit || loggableUnitsFor(lineIng).includes(u)) : [];
              return (
                <div key={line.id} className="slot-list__line">
                  <div className="slot-row">
                    <div className="slot-row__name">{lineDisplayName(line)}</div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.amount}
                      onChange={e => updateLineAmount(line.id, e.target.value)}
                    />
                    {unitOptions.length > 1 ? (
                      <select value={lineUnit} onChange={e => updateLineUnit(line.id, e.target.value)}>
                        {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    ) : (
                      <span className="slot-row__unit-static">{line.unit || 'g'}</span>
                    )}
                    <button type="button" className="slot-row__remove" aria-label="Remove" onClick={() => removeLine(line.id)}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {perServingPreview && (
          <div className="modal-highlight-panel" style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            <strong>Per container:</strong>{' '}
            +{perServingPreview.calories} cal · P {formatMacroMass(perServingPreview.protein_g, macroUnits)} ·{' '}
            C {formatMacroMass(perServingPreview.carbs_g, macroUnits)} · F {formatMacroMass(perServingPreview.fat_g, macroUnits)}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={saving ? 'btn-primary btn-loading' : 'btn-primary'} disabled={saving || receipt.length === 0}>
            {saving ? 'Saving…' : 'Update meal prep'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
