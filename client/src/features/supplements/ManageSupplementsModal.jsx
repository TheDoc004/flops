import { useEffect, useState } from 'react';
import {
  createSupplement,
  deleteSupplement,
  fetchSupplements,
  updateSupplement,
} from '@shared/api/supplements';

const EMPTY_FORM = {
  name: '',
  dose_text: '',
  counts_toward_macros: false,
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
};

function toForm(s) {
  return {
    name: s.name || '',
    dose_text: s.dose_text || '',
    counts_toward_macros: !!s.counts_toward_macros,
    calories: s.calories ? String(s.calories) : '',
    protein_g: s.protein_g ? String(s.protein_g) : '',
    carbs_g: s.carbs_g ? String(s.carbs_g) : '',
    fat_g: s.fat_g ? String(s.fat_g) : '',
  };
}

/**
 * CRUD for the user's supplement definitions. Rendered as a modal from the
 * dashboard card. Calls onChanged() after any create/update/delete so the
 * card can refresh today's checklist.
 */
export default function ManageSupplementsModal({ onClose, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null = add mode
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reload() {
    const list = await fetchSupplements();
    setItems(list || []);
  }

  useEffect(() => {
    let cancelled = false;
    fetchSupplements()
      .then(list => { if (!cancelled) setItems(list || []); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function startEdit(s) {
    setEditingId(s.id);
    setForm(toForm(s));
    setError('');
  }
  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true);
    setError('');
    const counts = form.counts_toward_macros;
    const payload = {
      name: form.name.trim(),
      dose_text: form.dose_text.trim() || null,
      counts_toward_macros: counts ? 1 : 0,
      calories: counts && form.calories !== '' ? Number(form.calories) : 0,
      protein_g: counts && form.protein_g !== '' ? Number(form.protein_g) : 0,
      carbs_g: counts && form.carbs_g !== '' ? Number(form.carbs_g) : 0,
      fat_g: counts && form.fat_g !== '' ? Number(form.fat_g) : 0,
    };
    try {
      if (editingId) await updateSupplement(editingId, payload);
      else await createSupplement(payload);
      await reload();
      resetForm();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(s) {
    if (!window.confirm(`Remove "${s.name}" from your supplements?`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteSupplement(s.id);
      if (editingId === s.id) resetForm();
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto',
          borderRadius: '16px 16px 0 0', padding: '20px 18px calc(20px + env(safe-area-inset-bottom))',
          boxShadow: '0 -6px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Manage supplements</h3>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 36, padding: '4px 12px' }}>
            Done
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {/* Existing list */}
        {loading ? (
          <p className="empty-state" style={{ padding: '12px 0' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty-state" style={{ padding: '12px 0', fontSize: 13 }}>
            No supplements yet — add your first below.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {items.map(s => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  background: editingId === s.id ? '#eff6ff' : '#f9fafb', borderRadius: 8, minHeight: 44,
                }}
              >
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {s.dose_text || 'No dose set'}
                    {s.counts_toward_macros ? ` · ${Math.round(s.calories)} cal counted` : ' · checklist only'}
                  </div>
                </div>
                <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px', minHeight: 32 }} onClick={() => startEdit(s)}>
                  Edit
                </button>
                <button type="button" className="btn-danger" style={{ fontSize: 12, padding: '5px 10px', minHeight: 32 }} onClick={() => void handleDelete(s)} disabled={busy}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add / edit form */}
        <form onSubmit={handleSubmit} style={{ borderTop: '1px solid #f0ede8', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
            {editingId ? 'Edit supplement' : 'Add a supplement'}
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280' }}>Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Whey Protein" required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280' }}>Dose (optional)</label>
            <input value={form.dose_text} onChange={e => setForm(f => ({ ...f, dose_text: e.target.value }))} placeholder="e.g. 1 scoop, 2000 IU" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.counts_toward_macros}
              onChange={e => setForm(f => ({ ...f, counts_toward_macros: e.target.checked }))}
              style={{ width: 16, height: 16 }}
            />
            Count its calories/macros toward my daily totals
          </label>
          {form.counts_toward_macros && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 8 }}>
              {[['calories', 'Cal'], ['protein_g', 'P (g)'], ['carbs_g', 'C (g)'], ['fat_g', 'F (g)']].map(([key, label]) => (
                <div key={key}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>{label}</label>
                  <input type="number" min="0" step="0.1" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editingId && (
              <button type="button" className="btn-secondary" style={{ minHeight: 40 }} onClick={resetForm} disabled={busy}>
                Cancel
              </button>
            )}
            <button type="submit" className={busy ? 'btn-primary btn-loading' : 'btn-primary'} style={{ minHeight: 40, padding: '0 20px' }} disabled={busy || !form.name.trim()}>
              {editingId ? 'Save changes' : 'Add supplement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
