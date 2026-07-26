import { useEffect, useRef, useState } from 'react';
import {
  createSupplement,
  deleteSupplement,
  fetchSupplements,
  scanSupplementLabel,
  updateSupplement,
} from '@shared/api/supplements';
import { MICRO_GROUPS } from '@shared/config/microNutrients';
import { LabelCropModal } from '@features/label-ocr';

const EMPTY_FORM = {
  name: '',
  dose_text: '',
  counts_toward_macros: false,
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  micros: {},
};

/** Saved micros ({ key: number }) → editable form strings, positives only. */
function microsToForm(micros) {
  const out = {};
  if (micros && typeof micros === 'object') {
    for (const [k, v] of Object.entries(micros)) {
      if (Number(v) > 0) out[k] = String(v);
    }
  }
  return out;
}

/** True when a supplement carries any micronutrient values. */
function hasMicros(s) {
  return !!(s?.micros && typeof s.micros === 'object' && Object.keys(s.micros).length > 0);
}

function toForm(s) {
  return {
    name: s.name || '',
    dose_text: s.dose_text || '',
    counts_toward_macros: !!s.counts_toward_macros,
    calories: s.calories ? String(s.calories) : '',
    protein_g: s.protein_g ? String(s.protein_g) : '',
    carbs_g: s.carbs_g ? String(s.carbs_g) : '',
    fat_g: s.fat_g ? String(s.fat_g) : '',
    micros: microsToForm(s.micros),
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
  const [microsOpen, setMicrosOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Label-scan flow: pick/take a photo → crop → AI reads it → prefill the form.
  const [scanImageSrc, setScanImageSrc] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const fileInputRef = useRef(null);

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
    setMicrosOpen(hasMicros(s)); // auto-expand when there are values to see
    setError('');
  }
  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMicrosOpen(false);
    setScanNote('');
  }

  // Chosen/taken photo → open the crop modal.
  function onPickScanPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setError('');
    setScanNote('');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setScanImageSrc(reader.result);
    };
    reader.readAsDataURL(file);
  }

  // Cropped image → AI reads the panel → prefill the form (never auto-saves).
  async function runScan(croppedUri) {
    setScanImageSrc(null);
    setScanBusy(true);
    setError('');
    setScanNote('');
    try {
      const blob = await (await fetch(croppedUri)).blob();
      const r = await scanSupplementLabel(blob);
      const microKeys = Object.keys(r.micros || {});
      const hasAny = microKeys.length > 0 || r.macros || r.name || r.dose_text;
      if (!hasAny) {
        setScanNote("Couldn't read any values — try a clearer, closer photo of the Supplement Facts panel.");
        return;
      }
      setForm(f => ({
        ...f,
        // Don't clobber anything the user already typed; fill blanks only.
        name: f.name.trim() ? f.name : (r.name || ''),
        dose_text: f.dose_text.trim() ? f.dose_text : (r.dose_text || ''),
        // Macros: if the label listed them, turn on counting and fill.
        counts_toward_macros: r.macros ? true : f.counts_toward_macros,
        calories: r.macros ? String(r.macros.calories) : f.calories,
        protein_g: r.macros ? String(r.macros.protein_g) : f.protein_g,
        carbs_g: r.macros ? String(r.macros.carbs_g) : f.carbs_g,
        fat_g: r.macros ? String(r.macros.fat_g) : f.fat_g,
        // Micros: scanned values win for the keys read.
        micros: { ...f.micros, ...Object.fromEntries(microKeys.map(k => [k, String(r.micros[k])])) },
      }));
      if (microKeys.length > 0) setMicrosOpen(true);
      const conf = r.confidence === 'high' ? '' : ` (${r.confidence} confidence — double-check the values)`;
      setScanNote(`Read ${microKeys.length} micronutrient${microKeys.length === 1 ? '' : 's'} from the label${conf}. Review and save.`);
    } catch (err) {
      setError(err.message || 'Failed to scan the label.');
    } finally {
      setScanBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true);
    setError('');
    const counts = form.counts_toward_macros;
    // Positive micro values only; the server whitelists keys and drops all-zero.
    const micros = {};
    for (const [k, v] of Object.entries(form.micros || {})) {
      if (v !== '' && Number.isFinite(Number(v)) && Number(v) > 0) micros[k] = Number(v);
    }
    const payload = {
      name: form.name.trim(),
      dose_text: form.dose_text.trim() || null,
      counts_toward_macros: counts ? 1 : 0,
      calories: counts && form.calories !== '' ? Number(form.calories) : 0,
      protein_g: counts && form.protein_g !== '' ? Number(form.protein_g) : 0,
      carbs_g: counts && form.carbs_g !== '' ? Number(form.carbs_g) : 0,
      fat_g: counts && form.fat_g !== '' ? Number(form.fat_g) : 0,
      micros,
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
    <>
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
                    {hasMicros(s) ? ` · ${Object.keys(s.micros).length} micro${Object.keys(s.micros).length === 1 ? '' : 's'}` : ''}
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

          {/* Fast path: read name/dose/macros/micros straight off the label. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickScanPhoto}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className={scanBusy ? 'btn-secondary btn-loading' : 'btn-secondary'}
            onClick={() => fileInputRef.current?.click()}
            disabled={scanBusy || busy}
            style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
          >
            {scanBusy ? 'Reading label…' : '📷 Scan Supplement Facts label'}
          </button>
          {scanNote && (
            <p style={{ margin: 0, fontSize: 12.5, color: '#1d7a5f', background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              {scanNote}
            </p>
          )}
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
          {/* Micronutrients (optional) — exact label values that count toward
              your daily micros in History whenever this supplement is checked. */}
          <div style={{ borderTop: '1px solid #f0ede8', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setMicrosOpen(o => !o)}
              aria-expanded={microsOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: '#374151',
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', transform: microsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
              Micronutrients (optional)
            </button>
            {microsOpen && (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                  Enter values straight from the label. They count toward your daily micronutrients
                  (in History) on any day this supplement is checked.
                </p>
                {MICRO_GROUPS.map(group => (
                  <div key={group.key} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                      {group.nutrients.map(n => (
                        <div key={n.key}>
                          <label style={{ fontSize: 12, color: '#6b7280' }}>{n.name} ({n.unit})</label>
                          <input
                            type="number" min="0" step="any"
                            value={form.micros?.[n.key] ?? ''}
                            onChange={e => setForm(f => ({ ...f, micros: { ...f.micros, [n.key]: e.target.value } }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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

      {/* Crop the photo before sending it to the AI reader. Rendered outside the
          overlay above, in a higher stacking context, so it sits on top and its
          backdrop clicks don't close the manage sheet. */}
      {scanImageSrc && (
        <div style={{ position: 'relative', zIndex: 2000 }}>
          <LabelCropModal
            open
            imageSrc={scanImageSrc}
            onClose={() => setScanImageSrc(null)}
            onApply={uri => void runScan(uri)}
          />
        </div>
      )}
    </>
  );
}
