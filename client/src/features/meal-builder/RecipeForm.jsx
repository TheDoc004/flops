import { useEffect, useState } from 'react';

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

function normalizeIngredientsForForm(initial) {
  const raw = initial?.ingredients;
  if (!Array.isArray(raw) || raw.length === 0) return [{ rowKind: 'line', name: '', amount: '' }];
  return raw.map(i => {
    if (i.kind === 'ingredient' && i.label_ingredient_id != null) {
      return {
        rowKind: 'line',
        name: i.name != null ? String(i.name) : '',
        amount: i.amount != null ? `${i.amount}${i.unit ? ` ${i.unit}` : ''}` : '',
        // Preserve library link on save when possible
        label_ingredient_id: Number(i.label_ingredient_id),
        unit: i.unit === 'oz' ? 'oz' : (i.unit || 'g'),
        amount_raw: i.amount != null ? String(i.amount) : '',
      };
    }
    if (i.kind === 'slot') {
      const opts = Array.isArray(i.option_label_ingredient_ids)
        ? i.option_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
        : [];
      const def = opts[0];
      return {
        rowKind: 'line',
        name: i.label != null ? String(i.label) : '',
        amount: i.amount != null ? `${i.amount}${i.unit ? ` ${i.unit}` : ''}` : '',
        label_ingredient_id: def || null,
        unit: i.unit === 'oz' ? 'oz' : (i.unit || 'g'),
        amount_raw: i.amount != null ? String(i.amount) : '',
      };
    }
    return {
      rowKind: 'line',
      name: i?.name != null ? String(i.name) : '',
      amount: i?.amount != null ? String(i.amount) : '',
    };
  });
}

function persistUnit(unit) {
  const u = String(unit || '').trim();
  if (/^(oz|ounce|ounces)$/i.test(u)) return 'oz';
  if (/^(g|gram|grams)$/i.test(u) || !u) return 'g';
  return u;
}

function parseRequiredMacro(raw, label) {
  if (raw === '' || raw == null) return { error: `${label} is required.` };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a valid number.` };
  return { value: n };
}

export default function RecipeForm({ initial = EMPTY, onSubmit, onLogOnce = null, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => ({
    ...initial,
    ingredients: normalizeIngredientsForForm(initial),
  }));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      ...initial,
      ingredients: normalizeIngredientsForForm(initial),
    });
  }, [initial]);

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

  function addLineRow() {
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { rowKind: 'line', name: '', amount: '' }] }));
  }

  function removeRow(index) {
    setForm(f => {
      const next = f.ingredients.filter((_, i) => i !== index);
      return { ...f, ingredients: next.length ? next : [{ rowKind: 'line', name: '', amount: '' }] };
    });
  }

  function collectIngredients() {
    const ingredients = [];
    for (const row of form.ingredients) {
      if (row.label_ingredient_id && row.amount_raw) {
        ingredients.push({
          kind: 'ingredient',
          name: row.name.trim() || `Ingredient #${row.label_ingredient_id}`,
          amount: String(row.amount_raw).trim(),
          unit: persistUnit(row.unit),
          label_ingredient_id: Number(row.label_ingredient_id),
        });
        continue;
      }
      const name = row.name.trim();
      const amount = row.amount.trim();
      if (name && amount) ingredients.push({ kind: 'line', name, amount });
    }
    return ingredients;
  }

  function parsedMacrosOrError() {
    const calories = parseRequiredMacro(form.calories, 'Calories');
    if (calories.error) return calories;
    const protein_g = parseRequiredMacro(form.protein_g, 'Protein');
    if (protein_g.error) return protein_g;
    const carbs_g = parseRequiredMacro(form.carbs_g, 'Carbs');
    if (carbs_g.error) return carbs_g;
    const fat_g = parseRequiredMacro(form.fat_g, 'Fat');
    if (fat_g.error) return fat_g;
    let fiber_g;
    if (form.fiber_g !== '') {
      const n = Number(form.fiber_g);
      if (!Number.isFinite(n) || n < 0) return { error: 'Fiber must be a valid number.' };
      fiber_g = n;
    }
    return {
      value: {
        calories: calories.value,
        protein_g: protein_g.value,
        carbs_g: carbs_g.value,
        fat_g: fat_g.value,
        fiber_g,
      },
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const macros = parsedMacrosOrError();
    if (macros.error) {
      setError(macros.error);
      return;
    }
    try {
      await onSubmit({
        name: form.name.trim(),
        serving_size: form.serving_size.trim(),
        ...macros.value,
        ingredients: collectIngredients(),
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogOnce() {
    if (!onLogOnce) return;
    setError('');
    const macros = parsedMacrosOrError();
    if (macros.error) {
      setError(macros.error);
      return;
    }
    try {
      const ingredients = collectIngredients();
      await onLogOnce({
        name: form.name.trim(),
        serving_size: form.serving_size.trim(),
        ...macros.value,
        ...(ingredients.length ? { ingredients } : {}),
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label>Name</label>
          <input value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label>Serving size</label>
          <input value={form.serving_size} onChange={set('serving_size')} required placeholder="e.g. 1 bowl" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
          <div>
            <label>Calories</label>
            <input type="number" min="0" step="any" value={form.calories} onChange={set('calories')} required />
          </div>
          <div>
            <label>Protein (g)</label>
            <input type="number" min="0" step="any" value={form.protein_g} onChange={set('protein_g')} required />
          </div>
          <div>
            <label>Carbs (g)</label>
            <input type="number" min="0" step="any" value={form.carbs_g} onChange={set('carbs_g')} required />
          </div>
          <div>
            <label>Fat (g)</label>
            <input type="number" min="0" step="any" value={form.fat_g} onChange={set('fat_g')} required />
          </div>
          <div>
            <label>Fiber (g)</label>
            <input type="number" min="0" step="any" value={form.fiber_g} onChange={set('fiber_g')} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ margin: 0 }}>Ingredients (optional notes)</label>
            <button type="button" className="btn-secondary" onClick={addLineRow}>+ Line</button>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            For library-backed meals, use Meal Builder. This form is for known-macro templates.
          </p>
          {form.ingredients.map((row, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                placeholder="Name"
                value={row.name}
                onChange={setIngredient(index, 'name')}
                style={{ flex: 2, minWidth: 120 }}
              />
              <input
                placeholder="Amount"
                value={row.amount}
                onChange={setIngredient(index, 'amount')}
                style={{ flex: 1, minWidth: 80 }}
              />
              <button type="button" className="btn-secondary" onClick={() => removeRow(index)}>Remove</button>
            </div>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="submit" className="btn-primary">{submitLabel}</button>
          {onLogOnce && (
            <button type="button" className="btn-secondary" onClick={() => void handleLogOnce()}>
              Log once
            </button>
          )}
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    </form>
  );
}
