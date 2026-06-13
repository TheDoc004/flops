import { useEffect, useState } from 'react';
import { createLabelIngredient } from '../api/labelIngredients';

const empty = (initialName = '') => ({
  name: initialName,
  brand_name: '',
  serving_size_text: '',
  grams_per_serving: '',
  calories: '',
  fat_g: '',
  carbs_g: '',
  protein_g: '',
  fiber_g: '',
});

/**
 * Compact modal to add a label ingredient (same payload as Ingredient Library / Meal Builder section 1).
 */
export default function IngredientCreateModal({ open, initialName = '', onClose, onSaved }) {
  const [form, setForm] = useState(() => empty(initialName));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(empty(initialName));
      setError('');
    }
  }, [open, initialName]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    const name = form.name.trim();
    const serving_size_text = form.serving_size_text.trim();
    if (!name || !serving_size_text) {
      setError('Display name and serving size (as printed) are required.');
      return;
    }
    const grams_per_serving = form.grams_per_serving === '' ? null : Number(form.grams_per_serving);
    if (grams_per_serving != null && (!Number.isFinite(grams_per_serving) || grams_per_serving <= 0)) {
      setError('Grams per serving must be a positive number or left empty.');
      return;
    }
    setSaving(true);
    try {
      const row = await createLabelIngredient({
        name,
        brand_name: form.brand_name.trim() || undefined,
        serving_size_text,
        grams_per_serving,
        calories: Number(form.calories),
        fat_g: Number(form.fat_g),
        carbs_g: Number(form.carbs_g),
        protein_g: Number(form.protein_g),
        fiber_g: form.fiber_g === '' ? undefined : Number(form.fiber_g),
        source_type: 'manual',
      });
      onSaved?.(row);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save ingredient');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingredient-create-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <h3 id="ingredient-create-title" style={{ marginTop: 0 }}>New ingredient</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Saved to your Ingredient Library and selected for this row. Macros are per serving as on the label.
        </p>
        {error && <p className="error">{error}</p>}
        <form onSubmit={submit} className="form-grid-2">
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Display name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Brand (optional)</label>
            <input value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} placeholder="e.g. brand or variant" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Serving size (as printed)</label>
            <input value={form.serving_size_text} onChange={e => setForm(f => ({ ...f, serving_size_text: e.target.value }))} placeholder='e.g. 170g' required />
          </div>
          <div>
            <label>Grams per serving</label>
            <input type="number" min="0.01" step="0.01" value={form.grams_per_serving} onChange={e => setForm(f => ({ ...f, grams_per_serving: e.target.value }))} placeholder="for scaling" />
          </div>
          <div>
            <label>Calories / serving</label>
            <input type="number" min="0" step="0.1" value={form.calories} onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} required />
          </div>
          <div><label>Fat (g) / serving</label><input type="number" min="0" step="0.1" value={form.fat_g} onChange={e => setForm(f => ({ ...f, fat_g: e.target.value }))} required /></div>
          <div><label>Carbs (g) / serving</label><input type="number" min="0" step="0.1" value={form.carbs_g} onChange={e => setForm(f => ({ ...f, carbs_g: e.target.value }))} required /></div>
          <div><label>Protein (g) / serving</label><input type="number" min="0" step="0.1" value={form.protein_g} onChange={e => setForm(f => ({ ...f, protein_g: e.target.value }))} required /></div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Fiber (g) / serving (optional)</label>
            <input type="number" min="0" step="0.1" value={form.fiber_g} onChange={e => setForm(f => ({ ...f, fiber_g: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn-secondary" onClick={() => onClose?.()} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save & use'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
