import { useEffect, useMemo, useRef, useState } from 'react';
import usePaginationAnchor from '@shared/hooks/usePaginationAnchor';
import {
  createLabelIngredient,
  deleteLabelIngredient,
  fetchLabelIngredients,
  updateLabelIngredient,
} from '@shared/api/labelIngredients';
import { fetchPreppedBatches } from '@shared/api/preppedBatches';
import PreppedBatchModal from './PreppedBatchModal';
import {
  LabelCropModal,
  extractTextFromLabelImage,
  parseNutritionFactsText,
  mergeNutritionParseIntoIngredientForm,
  scanFieldClass,
} from '@features/label-ocr';
import { BarcodeScannerModal, mergeBarcodeProductIntoIngredientForm } from '@features/barcode';
import { SERVING_UNITS, isWeightUnit, servingToStored, servingFromRow, emptyServing, unitLabel } from '@shared/utils/servingBasis';
import ServingUnitsHint from '@shared/ui/ServingUnitsHint';
import FeaturePrompt from '@shared/ui/FeaturePrompt';
import Reveal from '@shared/ui/Reveal';
import GrowStack from '@shared/ui/GrowStack';

function filterByName(items, q) {
  const query = String(q ?? '').trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!query) return [...list];
  return list.filter(x => {
    const name = String(x.name || '').toLowerCase();
    const brand = String(x.brand_name || '').toLowerCase();
    const base = String(x.base_label || '').toLowerCase();
    return name.includes(query) || brand.includes(query) || base.includes(query);
  });
}

const PAGE_SIZE = 10;

function emptyForm() {
  return {
    name: '',
    base_label: '',
    brand_name: '',
    ...emptyServing(), // serving_amount, serving_unit, serving_unit_custom, gram_equivalent
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
    fiber_g: '',
    source_type: 'manual',
  };
}

export default function Ingredients() {
  const [items, setItems] = useState([]);
  const [preppedBatches, setPreppedBatches] = useState([]);
  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('alpha_asc');
  const { page, setPage, paginationRef, handlePageChange } = usePaginationAnchor();
  // Which side new rows slide in from — follows the flip direction, like a book.
  const [slideFrom, setSlideFrom] = useState('right');
  // Height floor for the list area, captured on every flip: a shorter page
  // (especially the last one) must not shrink the card and pull the pagination
  // buttons up mid-click — short pages get white space instead.
  const listRef = useRef(null);
  const [listMinHeight, setListMinHeight] = useState(0);
  const flipPage = next => {
    const h = listRef.current?.offsetHeight || 0;
    setListMinHeight(prev => Math.max(prev, h));
    setSlideFrom(next > page ? 'right' : 'left');
    handlePageChange(next);
  };
  // A different result set has different natural heights — release the floor.
  useEffect(() => { setListMinHeight(0); }, [search, sort]);

  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const formDialogRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [labelPhotoPreview, setLabelPhotoPreview] = useState(null);
  const [labelPhotoDataUri, setLabelPhotoDataUri] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [labelScanFeedback, setLabelScanFeedback] = useState(null);
  const [labelScanFieldStatus, setLabelScanFieldStatus] = useState(null);
  const [labelCropOpen, setLabelCropOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  // The scanned code travels with the form so it is saved on the ingredient —
  // that is what makes a later re-scan find this item instead of duplicating it.
  const [scannedBarcode, setScannedBarcode] = useState(null);
  // Label micros from a barcode lookup, saved with the ingredient.
  const [scannedMicros, setScannedMicros] = useState(null);
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    try {
      const [ingredients, batches] = await Promise.all([
        fetchLabelIngredients(),
        fetchPreppedBatches(),
      ]);
      setItems(ingredients);
      setPreppedBatches(batches);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => filterByName(items, search), [items, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'recently_added') {
      arr.sort((a, b) => b.id - a.id);
    } else if (sort === 'recently_used') {
      arr.sort((a, b) => {
        const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return tb - ta;
      });
    } else if (sort === 'alpha_desc') {
      arr.sort((a, b) => String(b.name).localeCompare(String(a.name), undefined, { sensitivity: 'base' }));
    } else {
      arr.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
    }
    return arr;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = useMemo(() => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sorted, page]);

  useEffect(() => { setPage(1); }, [search, sort]);

  // Runs on every way out of the form dialog (✕, Esc, after save): next open
  // always starts from a fresh blank form.
  function closeForm() {
    setEditing(null);
    setFormOpen(false);
    setForm(emptyForm());
    setNotice('');
    clearLabelPhoto();
  }

  function clearLabelPhoto() {
    setLabelPhotoPreview(null);
    setLabelPhotoDataUri(null);
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
    setScannedBarcode(null);
    setScannedMicros(null);
  }

  /**
   * A barcode lookup came back. Same contract as the OCR scan: fill the form,
   * highlight what to check, save nothing. If this exact product is already in
   * the library, open that row instead of creating a near-duplicate.
   */
  function onBarcodeProduct(product) {
    const existing = product?.existing_ingredient;
    if (existing) {
      const row = items.find(i => i.id === existing.id);
      setNotice(`"${existing.name}" is already in your library. Opened it for editing.`);
      if (row) startEdit(row);
      return;
    }
    setNotice('');
    const { next, scanFeedback, fieldStatus } = mergeBarcodeProductIntoIngredientForm(form, product);
    setForm(next);
    setScannedBarcode(product?.barcode || null);
    // Micronutrients off the manufacturer's panel. There's no UI to edit 12
    // nutrients here, so they ride along invisibly and are stored with the
    // ingredient — where they later beat an AI estimate at log time.
    const micros = product?.micros && Object.keys(product.micros).length ? product.micros : null;
    setScannedMicros(micros);
    const microNote = micros
      ? [`Captured ${Object.keys(micros).length} micronutrients from the label. These will be used instead of estimates.`]
      : [];
    setLabelScanFeedback(scanFeedback ? [...scanFeedback, ...microNote] : microNote.length ? microNote : null);
    setLabelScanFieldStatus(fieldStatus);
  }

  function clearScanHints() {
    setLabelScanFieldStatus(null);
  }

  function onPickLabelPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      const uri = typeof reader.result === 'string' ? reader.result : null;
      setLabelPhotoPreview(uri);
      setLabelPhotoDataUri(uri);
    };
    reader.readAsDataURL(file);
  }

  async function runLibraryOcr() {
    if (!labelPhotoPreview) return;
    setOcrBusy(true);
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
    try {
      const blob = await (await fetch(labelPhotoPreview)).blob();
      const ocr = await extractTextFromLabelImage(blob);
      const text = ocr.ok ? String(ocr.text || '') : '';
      const parsed = parseNutritionFactsText(text);
      const prev = {
        name: form.name,
        serving_size_text: '',
        grams_per_serving: '',
        calories: form.calories,
        fat_g: form.fat_g,
        carbs_g: form.carbs_g,
        protein_g: form.protein_g,
        fiber_g: form.fiber_g,
      };
      const { next, scanFeedback, fieldStatus } = mergeNutritionParseIntoIngredientForm(prev, parsed);
      // Map scanned macros + a grams-per-serving (if read) onto the serving-basis form.
      setForm(f => ({
        ...f,
        name: next.name ?? f.name,
        calories: next.calories ?? f.calories,
        protein_g: next.protein_g ?? f.protein_g,
        carbs_g: next.carbs_g ?? f.carbs_g,
        fat_g: next.fat_g ?? f.fat_g,
        fiber_g: next.fiber_g ?? f.fiber_g,
        ...(next.grams_per_serving != null && next.grams_per_serving !== ''
          ? { serving_amount: String(next.grams_per_serving), serving_unit: 'g', serving_unit_custom: '' }
          : {}),
      }));
      const messages = [];
      if (ocr.errorMessage) messages.push(ocr.errorMessage);
      if (scanFeedback?.length) messages.push(...scanFeedback);
      setLabelScanFeedback(messages.length ? messages : null);
      setLabelScanFieldStatus(fieldStatus);
    } finally {
      setOcrBusy(false);
    }
  }

  function startEdit(row) {
    setEditing(row);
    setFormOpen(true);
    clearLabelPhoto();
    setForm({
      name: row.name || '',
      base_label: row.base_label || '',
      brand_name: row.brand_name || '',
      ...servingFromRow(row),
      calories: String(row.calories ?? ''),
      protein_g: String(row.protein_g ?? ''),
      carbs_g: String(row.carbs_g ?? ''),
      fat_g: String(row.fat_g ?? ''),
      fiber_g: row.fiber_g == null ? '' : String(row.fiber_g),
      source_type: row.source_type || 'manual',
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const stored = servingToStored(form);
      // How this entry came to be, most specific first.
      let source_type = form.source_type || 'manual';
      if (!editing && scannedBarcode) source_type = 'barcode';
      else if (!editing && labelPhotoDataUri) source_type = 'scanned_label';
      const body = {
        name: form.name.trim(),
        base_label: form.base_label.trim() || undefined,
        brand_name: form.brand_name.trim() || undefined,
        serving_size_text: stored.serving_size_text,
        grams_per_serving: stored.grams_per_serving,
        calories: Number(form.calories),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
        fiber_g: form.fiber_g === '' ? undefined : Number(form.fiber_g),
        source_type,
        barcode: scannedBarcode || undefined,
        micros: scannedMicros || undefined,
        tracking_type: stored.tracking_type,
        unit_name: stored.unit_name,
        serving_quantity: stored.serving_quantity,
        grams_per_unit: stored.grams_per_unit,
      };
      if (!editing && labelPhotoDataUri && labelPhotoDataUri.length < 350_000) {
        body.photo_data_uri = labelPhotoDataUri;
      }
      if (editing) {
        await updateLabelIngredient(editing.id, body);
      } else {
        await createLabelIngredient(body);
      }
      setEditing(null);
      setForm(emptyForm());
      setFormOpen(false);
      clearLabelPhoto();
      await load();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Reveal style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 className="page-title">Ingredient Library</h1>
      </Reveal>

      <Reveal delay={60}>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          Scan labels or add macros manually, then reuse them in recipes.
        </p>
      </Reveal>

      {error && <p className="error">{error}</p>}
      {notice && (
        <p
          role="status"
          style={{
            margin: '0 0 16px',
            padding: '10px 12px',
            fontSize: 13,
            color: '#1d7a5f',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: 8,
          }}
        >
          {notice}
        </p>
      )}

      {(formOpen || editing) && (
      <dialog
        ref={el => { formDialogRef.current = el; if (el && !el.open) el.showModal(); }}
        onClose={closeForm}
        style={{ width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{editing ? 'Edit ingredient' : 'Add a new ingredient'}</h2>
          <button
            type="button"
            className="modal-close-x"
            aria-label="Close"
            onClick={() => formDialogRef.current?.close()}
          >
            ✕
          </button>
        </div>

        {/* ── Scan barcode (optional, new entries only) ── */}
        {!editing && (
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 4px', fontSize: 15, fontWeight: 400,
              color: 'var(--color-primary-ink)', fontFamily: 'var(--font-sans)', fontWeight: 600,
            }}>
              Scan barcode{' '}
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)', fontFamily: 'inherit' }}>(optional)</span>
            </h4>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Fastest for packaged food. Fills the form from the product database.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setBarcodeOpen(true)}
              style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              Scan barcode
            </button>
          </div>
        )}

        {/* ── Scan label (optional, new entries only) ── */}
        {!editing && (
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 4px', fontSize: 15, fontWeight: 400,
              color: 'var(--color-primary-ink)', fontFamily: 'var(--font-sans)', fontWeight: 600,
            }}>
              Scan label{' '}
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)', fontFamily: 'inherit' }}>(optional)</span>
            </h4>
            <label style={{ display: 'block', marginBottom: 6 }}>Nutrition label photo</label>
            <input type="file" accept="image/*" onChange={onPickLabelPhoto} />
            {labelPhotoPreview && (
              <div style={{ marginTop: 10 }}>
                <img
                  src={labelPhotoPreview}
                  alt="Label preview"
                  style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="btn-secondary" disabled={ocrBusy} onClick={() => void runLibraryOcr()}>
                    {ocrBusy ? 'Reading…' : 'Read label (OCR)'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setLabelCropOpen(true)}>
                    Crop to nutrition panel
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => clearLabelPhoto()}>
                    Remove photo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Shared by both scans — barcode and label report findings the same way. */}
        {!editing && labelScanFeedback && labelScanFeedback.length > 0 && (
          <div
            role="status"
            style={{
              marginBottom: 20,
              padding: '10px 12px',
              fontSize: 13,
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>Review scan</strong>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {labelScanFeedback.map((msg, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={submit}>

          {/* ── Basic info ── */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{
              margin: '0 0 12px', fontSize: 15, fontWeight: 400,
              color: 'var(--color-primary-ink)', fontFamily: 'var(--font-sans)', fontWeight: 600,
            }}>Basic info</h4>
            <div className="form-grid-2">
              <div style={{ gridColumn: '1 / -1' }}>
                <label>Display name</label>
                <input
                  value={form.name}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, name: e.target.value }));
                  }}
                  placeholder="e.g. Greek yogurt"
                  required
                />
              </div>
              <div>
                <label>Base label / category <span style={{ color: 'var(--color-text-faint)', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
                <input
                  value={form.base_label}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, base_label: e.target.value }));
                  }}
                  placeholder="e.g. Yogurt"
                />
              </div>
              <div>
                <label>Brand / variant <span style={{ color: 'var(--color-text-faint)', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
                <input
                  value={form.brand_name}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, brand_name: e.target.value }));
                  }}
                  placeholder="e.g. Chobani 0%"
                />
              </div>
            </div>
          </div>

          {/* ── Serving & scaling ── */}
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 6px', fontSize: 15, fontWeight: 600,
              color: 'var(--color-primary-ink)', fontFamily: 'var(--font-sans)',
            }}>Serving &amp; scaling</h4>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-faint)' }}>
              Enter the serving size from the label. Use whatever it says: 170 g, 1 cup, 1 slice, 1 scoop, 1 egg.
            </p>
            <div className="form-grid-2">
              <div>
                <label htmlFor="ing-serving-amount">Serving amount</label>
                <input
                  id="ing-serving-amount"
                  type="number" min="0" step="0.01"
                  className={scanFieldClass(labelScanFieldStatus?.grams_per_serving)}
                  value={form.serving_amount}
                  onChange={e => { clearScanHints(); setForm(f => ({ ...f, serving_amount: e.target.value })); }}
                  placeholder="1"
                />
              </div>
              <div>
                <label htmlFor="ing-serving-unit">Serving unit</label>
                <select
                  id="ing-serving-unit"
                  value={form.serving_unit}
                  onChange={e => setForm(f => ({ ...f, serving_unit: e.target.value }))}
                >
                  {SERVING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  <option value="custom">custom…</option>
                </select>
              </div>
              {form.serving_unit === 'custom' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="ing-unit-custom">Unit name</label>
                  <input
                    id="ing-unit-custom"
                    value={form.serving_unit_custom}
                    onChange={e => setForm(f => ({ ...f, serving_unit_custom: e.target.value }))}
                    placeholder="e.g. bar, packet, bagel"
                  />
                </div>
              )}
              {!isWeightUnit(form.serving_unit) && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="ing-gram-equiv">
                    1 {unitLabel(form)} = grams <span style={{ color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    id="ing-gram-equiv"
                    type="number" min="0" step="0.01"
                    value={form.gram_equivalent}
                    onChange={e => setForm(f => ({ ...f, gram_equivalent: e.target.value }))}
                    placeholder="e.g. 31"
                  />
                  <ServingUnitsHint serving={form} unitName={unitLabel(form)} />
                </div>
              )}
            </div>
          </div>

          {/* ── Nutrition per serving ── */}
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 12px', fontSize: 15, fontWeight: 600,
              color: 'var(--color-primary-ink)', fontFamily: 'var(--font-sans)',
            }}>Nutrition per serving</h4>
            <div className="form-grid-2">
              <div>
                <label>Calories</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={scanFieldClass(labelScanFieldStatus?.calories)}
                  value={form.calories}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, calories: e.target.value }));
                  }}
                  required
                />
              </div>
              <div>
                <label>Protein (g)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={scanFieldClass(labelScanFieldStatus?.protein_g)}
                  value={form.protein_g}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, protein_g: e.target.value }));
                  }}
                  required
                />
              </div>
              <div>
                <label>Carbs (g)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={scanFieldClass(labelScanFieldStatus?.carbs_g)}
                  value={form.carbs_g}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, carbs_g: e.target.value }));
                  }}
                  required
                />
              </div>
              <div>
                <label>Fat (g)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={scanFieldClass(labelScanFieldStatus?.fat_g)}
                  value={form.fat_g}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, fat_g: e.target.value }));
                  }}
                  required
                />
              </div>
              <div>
                <label>Fiber (g) <span style={{ color: 'var(--color-text-faint)', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={scanFieldClass(labelScanFieldStatus?.fiber_g)}
                  value={form.fiber_g}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, fiber_g: e.target.value }));
                  }}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* ── Buttons ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {!editing && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setForm(emptyForm());
                  clearLabelPhoto();
                }}
              >
                Clear form
              </button>
            )}
            <button type="submit" className={saving ? 'btn-primary btn-loading' : 'btn-primary'} disabled={saving}>
              {saving
                ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>)
                : editing ? 'Save changes' : 'Save ingredient'}
            </button>
          </div>

        </form>
      </dialog>
      )}

      <Reveal className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="section-title">Your ingredients</h3>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn-secondary" onClick={() => setPrepModalOpen(true)}>
              Prep a batch
            </button>
            <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
              + Add ingredient
            </button>
          </div>
        </div>

        {preppedBatches.length > 0 && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active prepped batches
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {preppedBatches.map(b => {
                const pct = b.total_weight_g > 0
                  ? Math.round((Number(b.remaining_weight_g) / Number(b.total_weight_g)) * 100)
                  : 0;
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                    <strong>{b.name}</strong>
                    <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(Number(b.remaining_weight_g))}g left ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="ingredient-search" style={{ marginBottom: 4, display: 'block' }}>Search</label>
            <input
              id="ingredient-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, brand, or base label…"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="ingredient-sort" style={{ marginBottom: 4, display: 'block' }}>Sort by</label>
            <select
              id="ingredient-sort"
              value={sort}
              onChange={e => setSort(e.target.value)}
              style={{ height: 38 }}
            >
              <option value="alpha_asc">A – Z</option>
              <option value="alpha_desc">Z – A</option>
              <option value="recently_added">Recently added</option>
              <option value="recently_used">Recently used</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          items.length === 0 ? (
            <FeaturePrompt
              question="Cook the same protein every week?"
              answer="Save it once in your library and log by weight — or prep a cooked batch with fixed macros."
            />
          ) : (
            <p className="empty-state">No ingredients match your search.</p>
          )
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-faint)' }}>
              {filtered.length} ingredient{filtered.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
            <div
              ref={listRef}
              style={{ display: 'flex', flexDirection: 'column', minHeight: listMinHeight || undefined }}
            >
              <GrowStack slideFrom={slideFrom}>
              {paginated.map(i => (
                <div className="ingredient-card" key={i.id}>
                  <div className="ingredient-card-main">
                    <div className="ingredient-card-head">
                      <strong className="ingredient-card-name name-uniform">{i.name}</strong>
                      {i.brand_name ? <span style={{ color: 'var(--color-text-muted)' }}>({i.brand_name})</span> : null}
                      {i.base_label ? <span style={{ color: 'var(--color-text-faint)' }}>{i.base_label}</span> : null}
                    </div>
                    <div className="ingredient-card-meta">
                      {i.tracking_type === 'unit' && i.unit_name
                        ? <>per {i.serving_quantity != null ? i.serving_quantity : 1} {i.unit_name}</>
                        : <>{i.serving_size_text}{i.grams_per_serving != null ? ` · ${i.grams_per_serving}g/serving` : ''}</>
                      }
                      {' · '}{i.calories} cal
                    </div>
                  </div>
                  <div className="ingredient-card-actions">
                    <button type="button" className="btn-secondary" onClick={() => startEdit(i)}>Edit</button>
                    <button
                      type="button"
                      className="btn-danger-ghost"
                      onClick={async () => {
                        if (!window.confirm(`Delete ingredient "${i.name}"?`)) return;
                        await deleteLabelIngredient(i.id);
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              </GrowStack>
              {totalPages > 1 && paginated.length < PAGE_SIZE && (
                <div className="ghost-slots">
                  {Array.from({ length: PAGE_SIZE - paginated.length }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className="ghost-slot"
                      aria-label="Add an ingredient"
                      title="Add an ingredient"
                      onClick={() => setFormOpen(true)}
                      style={{ '--slide-delay': `${Math.min(paginated.length + i, 8) * 45}ms` }}
                    >
                      +
                    </button>
                  ))}
                </div>
              )}
            </div>
            {totalPages > 1 && (
              <div ref={paginationRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => flipPage(page - 1)}>Previous</button>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {page} of {totalPages}</span>
                <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => flipPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </Reveal>

      <LabelCropModal
        key={labelCropOpen ? labelPhotoPreview || 'open' : 'closed'}
        open={labelCropOpen}
        imageSrc={labelPhotoPreview}
        onClose={() => setLabelCropOpen(false)}
        onApply={uri => {
          setLabelCropOpen(false);
          setLabelPhotoPreview(uri);
          setLabelPhotoDataUri(uri);
          setLabelScanFeedback(null);
          setLabelScanFieldStatus(null);
        }}
      />

      {prepModalOpen && (
        <PreppedBatchModal
          onClose={() => setPrepModalOpen(false)}
          onSaved={() => void load()}
        />
      )}

      {/* Mounted only while open so the camera starts and stops with it. */}
      {barcodeOpen && (
        <BarcodeScannerModal
          onClose={() => setBarcodeOpen(false)}
          onProduct={onBarcodeProduct}
        />
      )}
    </div>
  );
}

