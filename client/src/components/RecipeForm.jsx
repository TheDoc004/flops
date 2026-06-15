import { useEffect, useMemo, useState } from 'react';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import { macrosForLabelServingAmount, sumMacroObjects } from '../utils/labelMacro';

const EMPTY = {
  name: '',
  serving_size: '',
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  fiber_g: '',
  ingredients: [{ rowKind: 'line', name: '', amount: '' }],
};

function newSlotRow() {
  return {
    rowKind: 'slot',
    slot_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    label: '',
    amount: '',
    unit: 'g',
    default_label_ingredient_id: '',
    substitute_label_ingredient_ids: [],
  };
}

function normalizeIngredientsForForm(initial) {
  const raw = initial?.ingredients;
  if (!Array.isArray(raw) || raw.length === 0) return [{ rowKind: 'line', name: '', amount: '' }];
  return raw.map(i => {
    if (i.kind === 'slot') {
      const opts = Array.isArray(i.option_label_ingredient_ids)
        ? i.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
        : [];
      const def = opts[0];
      const subs = opts.slice(1).filter(x => x !== def);
      return {
        rowKind: 'slot',
        slot_id:
          i.slot_id ||
          (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
        label: i.label != null ? String(i.label) : '',
        amount: i.amount != null ? String(i.amount) : '',
        unit: i.unit === 'oz' ? 'oz' : 'g',
        default_label_ingredient_id: def != null ? String(def) : '',
        substitute_label_ingredient_ids: subs,
      };
    }
    return {
      rowKind: 'line',
      name: i?.name != null ? String(i.name) : '',
      amount: i?.amount != null ? String(i.amount) : '',
    };
  });
}

function optionIdsFromSlotRow(row) {
  const def = Number(row.default_label_ingredient_id);
  if (!Number.isInteger(def) || def <= 0) return [];
  const subs = (row.substitute_label_ingredient_ids || [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0 && n !== def);
  return [def, ...subs];
}

export default function RecipeForm({ initial = EMPTY, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => ({
    ...initial,
    ingredients: normalizeIngredientsForForm(initial),
  }));
  const [error, setError] = useState('');
  const [labelIngredients, setLabelIngredients] = useState([]);

  useEffect(() => {
    void (async () => {
      try {
        setLabelIngredients(await fetchLabelIngredients());
      } catch {
        setLabelIngredients([]);
      }
    })();
  }, []);

  const labelById = useMemo(
    () => Object.fromEntries(labelIngredients.map(x => [String(x.id), x])),
    [labelIngredients]
  );

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  function setIngredient(index, field) {
    return e => {
      const v = e.target.value;
      setForm(f => {
        const ingredients = f.ingredients.map((row, i) =>
          i === index ? { ...row, [field]: v } : row
        );
        return { ...f, ingredients };
      });
    };
  }

  function setSlotUnit(index, unit) {
    setForm(f => {
      const ingredients = f.ingredients.map((row, i) => (i === index ? { ...row, unit } : row));
      return { ...f, ingredients };
    });
  }

  function setDefaultIngredient(index, labelIngredientId) {
    const id = Number(labelIngredientId);
    if (!Number.isInteger(id) || id <= 0) {
      setForm(f => {
        const ingredients = f.ingredients.map((row, i) =>
          i === index && row.rowKind === 'slot'
            ? { ...row, default_label_ingredient_id: '', substitute_label_ingredient_ids: [] }
            : row
        );
        return { ...f, ingredients };
      });
      return;
    }
    setForm(f => {
      const ingredients = f.ingredients.map((row, i) => {
        if (i !== index || row.rowKind !== 'slot') return row;
        return {
          ...row,
          default_label_ingredient_id: String(id),
          substitute_label_ingredient_ids: row.substitute_label_ingredient_ids.filter(x => x !== id),
        };
      });
      return { ...f, ingredients };
    });
  }

  function addSubstituteToSlot(index, labelIngredientId) {
    const id = Number(labelIngredientId);
    if (!Number.isInteger(id) || id <= 0) return;
    setForm(f => {
      const ingredients = f.ingredients.map((row, i) => {
        if (i !== index || row.rowKind !== 'slot') return row;
        const def = Number(row.default_label_ingredient_id);
        if (id === def) return row;
        if (row.substitute_label_ingredient_ids.includes(id)) return row;
        return { ...row, substitute_label_ingredient_ids: [...row.substitute_label_ingredient_ids, id] };
      });
      return { ...f, ingredients };
    });
  }

  function removeSubstituteFromSlot(index, labelIngredientId) {
    setForm(f => {
      const ingredients = f.ingredients.map((row, i) => {
        if (i !== index || row.rowKind !== 'slot') return row;
        return {
          ...row,
          substitute_label_ingredient_ids: row.substitute_label_ingredient_ids.filter(x => x !== labelIngredientId),
        };
      });
      return { ...f, ingredients };
    });
  }

  function addLineRow() {
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { rowKind: 'line', name: '', amount: '' }] }));
  }

  function addSlotRow() {
    setForm(f => ({ ...f, ingredients: [...f.ingredients, newSlotRow()] }));
  }

  function removeRow(index) {
    setForm(f => {
      const next = f.ingredients.filter((_, i) => i !== index);
      return { ...f, ingredients: next.length ? next : [{ rowKind: 'line', name: '', amount: '' }] };
    });
  }

  function estimateMacrosFromSlots() {
    const rows = [];
    for (const row of form.ingredients) {
      if (row.rowKind !== 'slot') continue;
      const defId = Number(row.default_label_ingredient_id);
      if (!Number.isInteger(defId) || defId <= 0) continue;
      const ing = labelById[String(defId)];
      if (!ing) continue;
      const m = macrosForLabelServingAmount(ing, row.amount, row.unit);
      if (m) rows.push(m);
    }
    if (rows.length === 0) {
      setError('Add variable slots with a default library ingredient and amount each, or enter macros manually.');
      return;
    }
    const t = sumMacroObjects(rows);
    setForm(f => ({
      ...f,
      calories: String(Math.round(t.calories * 10) / 10),
      protein_g: String(Math.round(t.protein_g * 10) / 10),
      carbs_g: String(Math.round(t.carbs_g * 10) / 10),
      fat_g: String(Math.round(t.fat_g * 10) / 10),
      fiber_g: t.fiber_g > 0 ? String(Math.round(t.fiber_g * 10) / 10) : '',
    }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const ingredients = [];
      for (const row of form.ingredients) {
        if (row.rowKind === 'slot') {
          const label = row.label.trim();
          const amount = String(row.amount ?? '').trim();
          const optionIds = optionIdsFromSlotRow(row);
          if (!label || !amount || optionIds.length === 0) continue;
          ingredients.push({
            kind: 'slot',
            slot_id: String(row.slot_id),
            label,
            amount,
            unit: row.unit === 'oz' ? 'oz' : 'g',
            option_label_ingredient_ids: optionIds,
          });
        } else {
          const name = row.name.trim();
          const amount = row.amount.trim();
          if (name && amount) ingredients.push({ kind: 'line', name, amount });
        }
      }
      await onSubmit({
        name: form.name.trim(),
        serving_size: form.serving_size.trim(),
        calories: Number(form.calories),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
        fiber_g: form.fiber_g !== '' ? Number(form.fiber_g) : undefined,
        ingredients,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  const sortedLabels = useMemo(
    () => [...labelIngredients].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [labelIngredients]
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label>Name</label>
        <input value={form.name} onChange={set('name')} required placeholder="e.g. Chicken Rice Bowl" />
      </div>
      <div>
        <label>Serving size</label>
        <input value={form.serving_size} onChange={set('serving_size')} required placeholder="e.g. 1 cup, 200g" />
      </div>
      <div className="form-grid-2">
        <div><label>Calories</label><input type="number" min="0" step="0.1" value={form.calories} onChange={set('calories')} required /></div>
        <div><label>Fat (g)</label><input type="number" min="0" step="0.1" value={form.fat_g} onChange={set('fat_g')} required /></div>
        <div><label>Carbs (g)</label><input type="number" min="0" step="0.1" value={form.carbs_g} onChange={set('carbs_g')} required /></div>
        <div><label>Protein (g)</label><input type="number" min="0" step="0.1" value={form.protein_g} onChange={set('protein_g')} required /></div>
        <div style={{ gridColumn: '1 / -1' }}><label>Fiber (g, optional)</label><input type="number" min="0" step="0.1" value={form.fiber_g} onChange={set('fiber_g')} /></div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <label style={{ margin: 0 }}>Ingredients</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={addLineRow}>+ Fixed line</button>
            <button type="button" className="btn-secondary" onClick={addSlotRow}>+ Ingredient slot</button>
            <button type="button" className="btn-secondary" onClick={estimateMacrosFromSlots} title="Sum macros from each slot using its default ingredient">
              Estimate macros from slots
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          <strong>Fixed lines</strong> are free-text notes. <strong>Ingredient slots</strong> use your Ingredient Library: pick a <strong>default</strong> and optional <strong>substitutes</strong>.
          When you log the recipe, you only choose an ingredient if that slot has substitutes; the saved recipe never changes.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {form.ingredients.map((row, index) =>
            row.rowKind === 'slot' ? (
              <div
                key={row.slot_id || index}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '2px dashed #93c5fd',
                  background: '#f8fafc',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-link)', marginBottom: 8 }}>Ingredient slot</div>
                <div className="form-grid-2">
                  <div>
                    <label style={{ fontSize: 12 }}>Slot label (e.g. Bacon)</label>
                    <input value={row.label} onChange={setIngredient(index, 'label')} placeholder="Shown when logging" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 12 }}>Amount</label>
                      <input type="number" min="0.01" step="0.01" value={row.amount} onChange={setIngredient(index, 'amount')} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12 }}>Unit</label>
                      <select value={row.unit} onChange={e => setSlotUnit(index, e.target.value)}>
                        <option value="g">g</option>
                        <option value="oz">oz</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 12 }}>Default ingredient</label>
                  <select
                    style={{ width: '100%', maxWidth: 420, marginTop: 4 }}
                    value={row.default_label_ingredient_id || ''}
                    onChange={e => setDefaultIngredient(index, e.target.value)}
                  >
                    <option value="">Select from library…</option>
                    {sortedLabels.map(li => (
                      <option key={li.id} value={li.id}>
                        {li.name}
                        {li.brand_name ? ` (${li.brand_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 12 }}>Substitutes (optional)</label>
                  <p style={{ margin: '4px 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    If you add substitutes, logging will ask which ingredient you used. Same portion (above) is used for macros.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    {row.substitute_label_ingredient_ids.map(oid => {
                      const ing = labelById[String(oid)];
                      return (
                        <span
                          key={oid}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            background: '#e0e7ff',
                            borderRadius: 6,
                            fontSize: 13,
                          }}
                        >
                          {ing ? ing.name : `#${oid}`}
                          <button type="button" aria-label="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} onClick={() => removeSubstituteFromSlot(index, oid)}>
                            ×
                          </button>
                        </span>
                      );
                    })}
                    <select
                      style={{ maxWidth: 260 }}
                      value=""
                      onChange={e => {
                        addSubstituteToSlot(index, e.target.value);
                        e.target.value = '';
                      }}
                      disabled={!row.default_label_ingredient_id}
                    >
                      <option value="">{row.default_label_ingredient_id ? '+ Add substitute…' : 'Choose a default first…'}</option>
                      {sortedLabels
                        .filter(li => {
                          const def = Number(row.default_label_ingredient_id);
                          if (li.id === def) return false;
                          if (row.substitute_label_ingredient_ids.includes(li.id)) return false;
                          return true;
                        })
                        .map(li => (
                          <option key={li.id} value={li.id}>
                            {li.name}
                            {li.brand_name ? ` (${li.brand_name})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => removeRow(index)}>
                  Remove slot
                </button>
              </div>
            ) : (
              <div key={`line-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 12 }}>Name</label>
                  <input value={row.name} onChange={setIngredient(index, 'name')} placeholder="e.g. Eggs" />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Amount</label>
                  <input value={row.amount} onChange={setIngredient(index, 'amount')} placeholder="e.g. 2 large" />
                </div>
                <button type="button" className="btn-secondary" onClick={() => removeRow(index)} aria-label="Remove ingredient">
                  Remove
                </button>
              </div>
            )
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
