import { useState } from 'react';

const EMPTY = { name: '', serving_size: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' };

export default function RecipeForm({ initial = EMPTY, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await onSubmit({
        name: form.name.trim(),
        serving_size: form.serving_size.trim(),
        calories: Number(form.calories),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
        fiber_g: form.fiber_g !== '' ? Number(form.fiber_g) : undefined,
      });
    } catch (err) {
      setError(err.message);
    }
  }

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label>Calories</label><input type="number" min="0" step="0.1" value={form.calories} onChange={set('calories')} required /></div>
        <div><label>Protein (g)</label><input type="number" min="0" step="0.1" value={form.protein_g} onChange={set('protein_g')} required /></div>
        <div><label>Carbs (g)</label><input type="number" min="0" step="0.1" value={form.carbs_g} onChange={set('carbs_g')} required /></div>
        <div><label>Fat (g)</label><input type="number" min="0" step="0.1" value={form.fat_g} onChange={set('fat_g')} required /></div>
        <div><label>Fiber (g, optional)</label><input type="number" min="0" step="0.1" value={form.fiber_g} onChange={set('fiber_g')} /></div>
      </div>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
