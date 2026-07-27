import { useEffect, useRef, useState } from 'react';
import {
  createSupplement,
  deleteSupplement,
  estimateSupplementFromName,
  fetchSupplementFromDatabase,
  fetchSupplements,
  scanSupplementLabel,
  searchSupplementDatabase,
  updateSupplement,
} from '@shared/api/supplements';
import { MICRO_GROUPS } from '@shared/config/microNutrients';
import { LabelCropModal } from '@features/label-ocr';
import { formatDoseUnit } from './doseFormat';

// Section headings match the ingredient form's serif treatment so the two
// "add a thing" surfaces read as one family.
const SECTION_HEADING = {
  margin: '0 0 10px',
  fontSize: 15,
  fontWeight: 400,
  color: 'var(--color-primary-ink)',
  fontFamily: "'DM Serif Display', Georgia, serif",
};

// Field labels sit at 13px, not 12px — small enough to defer to the value,
// big enough to actually read.
const FIELD_LABEL = { fontSize: 13, color: '#6b7280' };


const EMPTY_FORM = {
  name: '',
  dose_text: '',
  // The label's own serving, and how much of it you actually take. Stored
  // macros/micros describe ONE label serving, so these two turn them into
  // real intake — see supplementDose.js on the server.
  label_serving_qty: '1',
  label_serving_unit: 'serving',
  dose_qty: '1',
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
    label_serving_qty: s.label_serving_qty != null ? String(s.label_serving_qty) : '1',
    label_serving_unit: s.label_serving_unit || 'serving',
    dose_qty: s.dose_qty != null ? String(s.dose_qty) : '1',
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
  const dialogRef = useRef(null);
  // Name-lookup flow: type a product → NIH database results → pick → prefill.
  // This is the primary path; the photo scan is the fallback for what it lacks.
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupSearched, setLookupSearched] = useState(false);
  const [estimateBusy, setEstimateBusy] = useState(false);
  // A picked product is previewed before it touches the form — that's how you
  // tell near-identical database entries apart.
  const [preview, setPreview] = useState(null);
  const [expandedVersions, setExpandedVersions] = useState(null); // group id

  // How far your dose is from the label's serving — drives the plain-language
  // warning, and matches the factor the server applies when counting.
  const labelQty = Number(form.label_serving_qty);
  const takeQty = Number(form.dose_qty);
  const doseMultiplier =
    Number.isFinite(labelQty) && labelQty > 0 && Number.isFinite(takeQty) && takeQty > 0
      ? takeQty / labelQty
      : 1;

  // Shown on the collapsed micros header, so a filled-in section isn't hidden
  // behind a closed expander that looks identical to an empty one.
  const microCount = Object.values(form.micros || {}).filter(
    v => v !== '' && Number.isFinite(Number(v)) && Number(v) > 0
  ).length;
  // Where the current micro values came from — decides the confidence stored.
  const [microsSource, setMicrosSource] = useState(null); // 'label' | 'estimate'

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
    setLookupQuery('');
    setLookupResults([]);
    setLookupSearched(false);
    setMicrosSource(null);
    setPreview(null);
    setExpandedVersions(null);
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

  // Debounced name search. Nothing is set synchronously here — the state
  // changes all happen inside the timer, after the user stops typing.
  useEffect(() => {
    const q = lookupQuery.trim();
    if (q.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookupBusy(true);
      try {
        const r = await searchSupplementDatabase(q);
        if (!cancelled) {
          setLookupResults(r?.results || []);
          setLookupSearched(true);
        }
      } catch (e) {
        if (!cancelled) {
          setLookupResults([]);
          setLookupSearched(true);
          setError(e.message);
        }
      } finally {
        if (!cancelled) setLookupBusy(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lookupQuery]);

  // A search hit → pull its label → SHOW it. Nothing touches the form until
  // you confirm, so a wrong pick costs a click instead of overwriting entries.
  async function previewFromDatabase(id) {
    setError('');
    setScanNote('');
    setLookupBusy(true);
    try {
      setPreview(await fetchSupplementFromDatabase(id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLookupBusy(false);
    }
  }

  /** Confirmed from the preview → fill the form. Label-exact, like a scan. */
  function usePreviewedProduct() {
    const label = preview;
    if (!label) return;
    const filled = applyLabelToForm(label);
    setMicrosSource('label');
    setPreview(null);
    setLookupResults([]);
    setLookupQuery('');
    setExpandedVersions(null);
    const extra = label.notes ? ` ${label.notes}` : '';
    setScanNote(
      filled > 0
        ? `Filled ${filled} micronutrient${filled === 1 ? '' : 's'} from the ${label.brand || 'product'} label.${extra} Review and save.`
        : `That label lists no micronutrients this app tracks.${extra}`
    );
  }

  // Nothing in the database → ask the AI from the name. Always an estimate,
  // and stored as one, so it can't be mistaken for label data later.
  async function runEstimate() {
    const q = (lookupQuery.trim() || form.name.trim()).slice(0, 200);
    if (q.length < 2) return;
    setError('');
    setScanNote('');
    setEstimateBusy(true);
    try {
      const r = await estimateSupplementFromName(q);
      if (!r.recognized || Object.keys(r.micros || {}).length === 0) {
        setScanNote(`Couldn't estimate "${q}" — try the full product name, or scan the label.`);
        return;
      }
      const filled = applyLabelToForm(r);
      setMicrosSource('estimate');
      setLookupResults([]);
      setScanNote(
        `Estimated ${filled} micronutrient${filled === 1 ? '' : 's'} from the name (${r.confidence} confidence). ` +
          'These are NOT read off a label — check them against the bottle before saving.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setEstimateBusy(false);
    }
  }

  /**
   * Fill the form from a label-shaped result — shared by all three sources
   * (photo scan, NIH database match, name estimate), which is why the server
   * gives them all the same shape. Never auto-saves; blanks only for text the
   * user already typed.
   * @returns {number} how many micronutrients were filled
   */
  function applyLabelToForm(r) {
    const microKeys = Object.keys(r.micros || {});
    setForm(f => ({
      ...f,
      name: f.name.trim() ? f.name : (r.name || ''),
      dose_text: f.dose_text.trim() ? f.dose_text : (r.dose_text || ''),
      // A freshly captured label resets the serving it describes; your dose
      // starts equal to it, then you say if you take more.
      label_serving_qty: r.serving_qty != null ? String(r.serving_qty) : f.label_serving_qty,
      label_serving_unit: r.serving_unit || f.label_serving_unit,
      dose_qty: r.serving_qty != null ? String(r.serving_qty) : f.dose_qty,
      counts_toward_macros: r.macros ? true : f.counts_toward_macros,
      calories: r.macros ? String(r.macros.calories) : f.calories,
      protein_g: r.macros ? String(r.macros.protein_g) : f.protein_g,
      carbs_g: r.macros ? String(r.macros.carbs_g) : f.carbs_g,
      fat_g: r.macros ? String(r.macros.fat_g) : f.fat_g,
      micros: { ...f.micros, ...Object.fromEntries(microKeys.map(k => [k, String(r.micros[k])])) },
    }));
    if (microKeys.length > 0) setMicrosOpen(true);
    return microKeys.length;
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
      const hasAny = Object.keys(r.micros || {}).length > 0 || r.macros || r.name || r.dose_text;
      if (!hasAny) {
        setScanNote("Couldn't read any values — try a clearer, closer photo of the Supplement Facts panel.");
        return;
      }
      const filled = applyLabelToForm(r);
      setMicrosSource('label');
      const conf = r.confidence === 'high' ? '' : ` (${r.confidence} confidence — double-check the values)`;
      setScanNote(`Read ${filled} micronutrient${filled === 1 ? '' : 's'} from the label${conf}. Review and save.`);
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
      label_serving_qty: Number(form.label_serving_qty) > 0 ? Number(form.label_serving_qty) : 1,
      label_serving_unit: form.label_serving_unit.trim() || 'serving',
      dose_qty: Number(form.dose_qty) > 0 ? Number(form.dose_qty) : Number(form.label_serving_qty) || 1,
      counts_toward_macros: counts ? 1 : 0,
      calories: counts && form.calories !== '' ? Number(form.calories) : 0,
      protein_g: counts && form.protein_g !== '' ? Number(form.protein_g) : 0,
      carbs_g: counts && form.carbs_g !== '' ? Number(form.carbs_g) : 0,
      fat_g: counts && form.fat_g !== '' ? Number(form.fat_g) : 0,
      micros,
      // An AI estimate must never be stored at label confidence — History
      // treats supplement micros as exact, and this is the one path that isn't.
      ...(microsSource === 'estimate'
        ? { micros_confidence: 'medium', micros_source: 'Estimated from the product name' }
        : {}),
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
      {/* Native <dialog>, like Log a Meal and the ingredient form: centered, with
          the shared backdrop, rise-in animation and Esc handling from index.css
          rather than a hand-rolled bottom sheet. */}
      <dialog
        ref={el => { dialogRef.current = el; if (el && !el.open) el.showModal(); }}
        onClose={onClose}
        style={{ width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Manage supplements</h2>
          <button type="button" className="modal-close-x" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            ✕
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {/* Existing list */}
        {!loading && items.length > 0 && (
          <h4 style={SECTION_HEADING}>Your supplements ({items.length})</h4>
        )}
        {loading ? (
          <p className="empty-state" style={{ padding: '12px 0' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty-state" style={{ padding: '12px 0', fontSize: 13 }}>
            No supplements yet — add your first below.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
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
        <form onSubmit={handleSubmit} style={{ borderTop: '1px solid #f0ede8', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Editing is easy to miss when the form sits below the list, so say
              plainly which supplement is being changed. */}
          {editingId ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
              <span style={{ fontSize: 14 }}>
                Editing <strong>{form.name || 'supplement'}</strong>
              </span>
              <button type="button" className="btn-secondary" style={{ fontSize: 13, padding: '4px 12px', minHeight: 32 }} onClick={resetForm} disabled={busy}>
                Add a new one instead
              </button>
            </div>
          ) : (
            <h4 style={SECTION_HEADING}>Add a supplement</h4>
          )}

          {/* Two ways to fill this in without typing, framed as alternatives —
              you pick based on whether the product is in the database. Available
              while editing too, so an existing entry can be refreshed from a
              label rather than retyped. */}
          <div style={{ padding: '12px 14px', background: '#f9fafb', border: '1px solid #f0ede8', borderRadius: 10 }}>
            <strong style={{ display: 'block', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              {editingId ? 'Refresh from a label:' : 'Fill it in for me:'}
            </strong>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Search the NIH supplement label database — real label values, no photo needed.
            </p>
            <input
              value={lookupQuery}
              onChange={e => {
                setLookupQuery(e.target.value);
                if (e.target.value.trim().length < 2) {
                  setLookupResults([]);
                  setLookupSearched(false);
                }
              }}
              placeholder="e.g. Centrum Men, Nordic Naturals Omega"
              aria-label="Search supplements by name"
              style={{ width: '100%' }}
            />

            {lookupBusy && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>Searching…</p>
            )}

            {/* Preview: see the actual values before they touch the form. */}
            {preview && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#fff', border: '1px solid #c7d2fe', borderRadius: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{preview.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  {[preview.brand, preview.dose_text && `per ${preview.dose_text}`].filter(Boolean).join(' · ')}
                </div>

                {Object.keys(preview.micros || {}).length > 0 ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '2px 12px' }}>
                    {MICRO_GROUPS.flatMap(g => g.nutrients)
                      .filter(n => preview.micros[n.key] != null)
                      .map(n => (
                        <li key={n.key} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: '#4b5563' }}>{n.name}</span>
                          <span style={{ fontWeight: 600 }}>{preview.micros[n.key]} {n.unit}</span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                    No micronutrients this app tracks.
                  </p>
                )}

                {preview.macros && (
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: '#4b5563' }}>
                    {Math.round(preview.macros.calories)} cal · P {preview.macros.protein_g} · C {preview.macros.carbs_g} · F {preview.macros.fat_g}
                  </p>
                )}
                {preview.notes && (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#92400e', lineHeight: 1.5 }}>{preview.notes}</p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-primary" style={{ minHeight: 40 }} onClick={usePreviewedProduct}>
                    Use this product
                  </button>
                  <button type="button" className="btn-secondary" style={{ minHeight: 40 }} onClick={() => setPreview(null)}>
                    Back to results
                  </button>
                </div>
              </div>
            )}

            {!preview && lookupResults.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                {lookupResults.map(hit => {
                  // The details that actually separate near-identical entries.
                  const facts = [
                    hit.form,
                    hit.net_contents,
                    hit.nutrient_count ? `${hit.nutrient_count} nutrients` : '',
                    hit.entry_date ? `label from ${hit.entry_date.slice(0, 4)}` : '',
                  ].filter(Boolean);
                  return (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => void previewFromDatabase(hit.id)}
                        disabled={lookupBusy}
                        style={{
                          width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e5e7eb',
                          borderRadius: 8, padding: '8px 10px', minHeight: 44, cursor: 'pointer', font: 'inherit',
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                          {hit.name}
                          {hit.off_market && (
                            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 5px' }}>
                              discontinued
                            </span>
                          )}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
                          {hit.brand || 'Unknown brand'}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>{facts.join(' · ')}</span>
                      </button>

                      {/* Same product, earlier labels — kept out of the way. */}
                      {hit.older_versions?.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpandedVersions(expandedVersions === hit.id ? null : hit.id)}
                            style={{ background: 'none', border: 'none', padding: '4px 10px', font: 'inherit', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            {expandedVersions === hit.id ? 'Hide' : `${hit.older_versions.length} earlier label${hit.older_versions.length === 1 ? '' : 's'}`}
                          </button>
                          {expandedVersions === hit.id && (
                            <ul style={{ listStyle: 'none', margin: '2px 0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {hit.older_versions.map(v => (
                                <li key={v.id}>
                                  <button
                                    type="button"
                                    onClick={() => void previewFromDatabase(v.id)}
                                    disabled={lookupBusy}
                                    style={{
                                      width: '100%', textAlign: 'left', background: '#f9fafb', border: '1px solid #e5e7eb',
                                      borderRadius: 6, padding: '6px 10px', minHeight: 36, cursor: 'pointer', font: 'inherit', fontSize: 12, color: '#4b5563',
                                    }}
                                  >
                                    {[v.entry_date ? `label from ${v.entry_date.slice(0, 4)}` : '', v.net_contents, v.nutrient_count ? `${v.nutrient_count} nutrients` : '', v.off_market ? 'discontinued' : '']
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {lookupSearched && !lookupBusy && lookupResults.length === 0 && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Nothing found — it may not be in the database (it covers US products).
              </p>
            )}

            {/* The two fallbacks, only once there's something to act on. */}
            {lookupQuery.trim().length >= 2 && (
              <button
                type="button"
                className={estimateBusy ? 'btn-secondary btn-loading' : 'btn-secondary'}
                onClick={() => void runEstimate()}
                disabled={estimateBusy || lookupBusy || busy}
                style={{ marginTop: 10, minHeight: 40 }}
              >
                {estimateBusy ? 'Estimating…' : '✨ Estimate from the name instead'}
              </button>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e5e7eb' }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Not in the database? Read it off the bottle instead:
              </p>
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
                style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {scanBusy ? 'Reading label…' : '📷 Scan Supplement Facts label'}
              </button>
            </div>
          </div>

          {scanNote && (
            <p style={{ margin: 0, fontSize: 13, color: '#1d7a5f', background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              {scanNote}
            </p>
          )}

          <div>
            <h4 style={SECTION_HEADING}>Details</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={FIELD_LABEL}>Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Whey Protein" required />
              </div>
              {/* The whole point: the label's serving and YOUR dose are
                  different things. Everything captured describes one label
                  serving, so saying you take more must scale it. */}
              <div style={{ padding: '10px 12px', background: '#f9fafb', border: '1px solid #f0ede8', borderRadius: 8 }}>
                <strong style={{ display: 'block', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  How much you take
                </strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={FIELD_LABEL}>The label calls one serving</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="number" min="0" step="any" style={{ width: 70 }}
                        value={form.label_serving_qty}
                        onChange={e => setForm(f => ({ ...f, label_serving_qty: e.target.value }))}
                        aria-label="Label serving amount"
                      />
                      <input
                        value={form.label_serving_unit}
                        onChange={e => setForm(f => ({ ...f, label_serving_unit: e.target.value }))}
                        placeholder="softgel"
                        aria-label="Serving unit"
                        style={{ minWidth: 0 }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={FIELD_LABEL}>You actually take</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number" min="0" step="any" style={{ width: 70 }}
                        value={form.dose_qty}
                        onChange={e => setForm(f => ({ ...f, dose_qty: e.target.value }))}
                        aria-label="Amount you take"
                      />
                      <span style={{ fontSize: 14, color: 'var(--color-text-body)' }}>
                        {formatDoseUnit(form.label_serving_unit, Number(form.dose_qty))}
                      </span>
                    </div>
                  </div>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: doseMultiplier === 1 ? 'var(--color-text-muted)' : '#92400e', lineHeight: 1.5 }}>
                  {doseMultiplier === 1
                    ? 'You take exactly one label serving, so the values below are counted as printed.'
                    : `You take ${+doseMultiplier.toFixed(2)}× the label serving, so everything below is multiplied by ${+doseMultiplier.toFixed(2)} when counted.`}
                </p>
              </div>

              <div>
                <label style={FIELD_LABEL}>Dose note (optional)</label>
                <input value={form.dose_text} onChange={e => setForm(f => ({ ...f, dose_text: e.target.value }))} placeholder="e.g. with breakfast" />
              </div>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.counts_toward_macros}
              onChange={e => setForm(f => ({ ...f, counts_toward_macros: e.target.checked }))}
              style={{ width: 16, height: 16 }}
            />
            Count its calories/macros toward my daily totals
          </label>
          {form.counts_toward_macros && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 8, marginTop: -2 }}>
              {[['calories', 'Cal'], ['protein_g', 'P (g)'], ['carbs_g', 'C (g)'], ['fat_g', 'F (g)']].map(([key, label]) => (
                <div key={key}>
                  <label style={FIELD_LABEL}>{label}</label>
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
                fontSize: 15, fontWeight: 600, color: 'var(--color-text-body)',
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', transform: microsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
              Micronutrients{microCount > 0 ? ` (${microCount} filled)` : ' (optional)'}
            </button>
            {microsOpen && (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  Enter values straight from the label. They count toward your daily micronutrients
                  (in History) on any day this supplement is checked.
                </p>
                {MICRO_GROUPS.map(group => (
                  <div key={group.key} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                      {group.nutrients.map(n => (
                        <div key={n.key}>
                          <label style={FIELD_LABEL}>{n.name} ({n.unit})</label>
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
      </dialog>

      {/* Crop the photo before sending it to the AI reader. Rendered outside the
          dialog above, in a higher stacking context, so it sits on top and its
          backdrop clicks don't close the manage dialog. */}
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
