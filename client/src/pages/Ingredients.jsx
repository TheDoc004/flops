import { useEffect, useMemo, useState } from 'react';
import {
  createLabelIngredient,
  deleteLabelIngredient,
  fetchLabelIngredients,
  updateLabelIngredient,
} from '../api/labelIngredients';
import LabelCropModal from '../components/LabelCropModal';
import { extractTextFromLabelImage } from '../utils/labelOcr';
import { parseNutritionFactsText } from '../utils/labelParse';
import { mergeNutritionParseIntoIngredientForm, scanFieldClass } from '../utils/mergeNutritionParseIntoIngredientForm';

function filterByName(items, q) {
  const query = String(q ?? '').trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!query) return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return list
    .filter(x => {
      const name = String(x.name || '').toLowerCase();
      const brand = String(x.brand_name || '').toLowerCase();
      const base = String(x.base_label || '').toLowerCase();
      return name.includes(query) || brand.includes(query) || base.includes(query);
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

function emptyForm() {
  return {
    name: '',
    base_label: '',
    brand_name: '',
    serving_size_text: '',
    grams_per_serving: '',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
    fiber_g: '',
    source_type: 'manual',
    tracking_type: 'weight',
    unit_name: '',
    serving_quantity: '1',
    grams_per_unit: '',
  };
}

export default function Ingredients() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [labelPhotoPreview, setLabelPhotoPreview] = useState(null);
  const [labelPhotoDataUri, setLabelPhotoDataUri] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [labelScanFeedback, setLabelScanFeedback] = useState(null);
  const [labelScanFieldStatus, setLabelScanFieldStatus] = useState(null);
  const [labelCropOpen, setLabelCropOpen] = useState(false);

  async function load() {
    setError('');
    try {
      setItems(await fetchLabelIngredients());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => filterByName(items, search), [items, search]);

  function clearLabelPhoto() {
    setLabelPhotoPreview(null);
    setLabelPhotoDataUri(null);
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
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
        base_label: form.base_label,
        brand_name: form.brand_name,
        serving_size_text: form.serving_size_text,
        grams_per_serving: form.grams_per_serving,
        calories: form.calories,
        fat_g: form.fat_g,
        carbs_g: form.carbs_g,
        protein_g: form.protein_g,
        fiber_g: form.fiber_g,
      };
      const { next, scanFeedback, fieldStatus } = mergeNutritionParseIntoIngredientForm(prev, parsed);
      setForm(f => ({ ...f, ...next }));
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
    clearLabelPhoto();
    setForm({
      name: row.name || '',
      base_label: row.base_label || '',
      brand_name: row.brand_name || '',
      serving_size_text: row.serving_size_text || '',
      grams_per_serving: row.grams_per_serving == null ? '' : String(row.grams_per_serving),
      calories: String(row.calories ?? ''),
      protein_g: String(row.protein_g ?? ''),
      carbs_g: String(row.carbs_g ?? ''),
      fat_g: String(row.fat_g ?? ''),
      fiber_g: row.fiber_g == null ? '' : String(row.fiber_g),
      source_type: row.source_type || 'manual',
      tracking_type: row.tracking_type || 'weight',
      unit_name: row.unit_name || '',
      serving_quantity: row.serving_quantity == null ? '1' : String(row.serving_quantity),
      grams_per_unit: row.grams_per_unit == null ? '' : String(row.grams_per_unit),
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const isUnit = form.tracking_type === 'unit';
      const body = {
        name: form.name.trim(),
        base_label: form.base_label.trim() || undefined,
        brand_name: form.brand_name.trim() || undefined,
        serving_size_text: form.serving_size_text.trim(),
        grams_per_serving: form.grams_per_serving === '' ? null : Number(form.grams_per_serving),
        calories: Number(form.calories),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
        fiber_g: form.fiber_g === '' ? undefined : Number(form.fiber_g),
        source_type:
          !editing && labelPhotoDataUri ? 'scanned_label' : form.source_type || 'manual',
        tracking_type: form.tracking_type || 'weight',
        unit_name: isUnit && form.unit_name.trim() ? form.unit_name.trim() : undefined,
        serving_quantity: isUnit && form.serving_quantity !== '' ? Number(form.serving_quantity) : undefined,
        grams_per_unit: isUnit && form.grams_per_unit !== '' ? Number(form.grams_per_unit) : undefined,
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{
          margin: 0, fontSize: 32, fontWeight: 400,
          color: '#1e1b4b', letterSpacing: '-0.02em', lineHeight: 1.1,
          fontFamily: "'DM Serif Display', Georgia, serif",
        }}>Ingredient Library</h1>
      </div>

      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
        Save ingredients once, then reuse them forever in Meal Builder recipes. Variants (brands) are supported. Add
        items by typing macros manually or by uploading a nutrition-label photo (assisted scan — verify before saving).
      </p>

      {error && <p className="error">{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{
          margin: '0 0 16px', fontSize: 20, fontWeight: 400,
          color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
        }}>{editing ? 'Edit ingredient' : 'New ingredient'}</h3>

        {/* ── Scan label (optional, new entries only) ── */}
        {!editing && (
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 4px', fontSize: 15, fontWeight: 400,
              color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
            }}>
              Scan label{' '}
              <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'inherit' }}>(optional)</span>
            </h4>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9ca3af' }}>
              Upload a nutrition label photo and run OCR to pre-fill the fields below. Always verify before saving.
            </p>
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
                {labelScanFeedback && labelScanFeedback.length > 0 && (
                  <div
                    role="status"
                    style={{
                      marginTop: 10,
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
              </div>
            )}
          </div>
        )}

        <form onSubmit={submit}>

          {/* ── Basic info ── */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{
              margin: '0 0 12px', fontSize: 15, fontWeight: 400,
              color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
            }}>Basic info</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                <label>Base label / category <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
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
                <label>Brand / variant <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
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

          {/* ── Logging style ── */}
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 10px', fontSize: 15, fontWeight: 400,
              color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
            }}>Logging style</h4>
            <div style={{ display: 'flex', gap: 20, marginBottom: form.tracking_type === 'unit' ? 14 : 0 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="tracking_type"
                  value="weight"
                  checked={form.tracking_type !== 'unit'}
                  onChange={() => setForm(f => ({ ...f, tracking_type: 'weight' }))}
                />
                By weight
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="tracking_type"
                  value="unit"
                  checked={form.tracking_type === 'unit'}
                  onChange={() => setForm(f => ({ ...f, tracking_type: 'unit' }))}
                />
                By unit
              </label>
            </div>
            {form.tracking_type === 'unit' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label>Unit name</label>
                  <input
                    value={form.unit_name}
                    onChange={e => setForm(f => ({ ...f, unit_name: e.target.value }))}
                    placeholder="e.g. slice, egg, scoop, bar"
                    required={form.tracking_type === 'unit'}
                  />
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                    How it will appear when logging (e.g. "2 slices").
                  </p>
                </div>
                <div>
                  <label>Units per serving <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(usually 1)</span></label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.serving_quantity}
                    onChange={e => setForm(f => ({ ...f, serving_quantity: e.target.value }))}
                    placeholder="1"
                  />
                </div>
                <div>
                  <label>Grams per unit <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.grams_per_unit}
                    onChange={e => setForm(f => ({ ...f, grams_per_unit: e.target.value }))}
                    placeholder="e.g. 40"
                  />
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                    For future weight equivalency. Optional for now.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Serving & scaling ── */}
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 12px', fontSize: 15, fontWeight: 400,
              color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
            }}>Serving & scaling</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label>
                  {form.tracking_type === 'unit'
                    ? <>Serving label <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(e.g. 1 slice, 1 large egg)</span></>
                    : <>Serving size <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(as printed)</span></>
                  }
                </label>
                <input
                  className={scanFieldClass(labelScanFieldStatus?.serving_size_text)}
                  value={form.serving_size_text}
                  onChange={e => {
                    clearScanHints();
                    setForm(f => ({ ...f, serving_size_text: e.target.value }));
                  }}
                  placeholder={form.tracking_type === 'unit' ? 'e.g. 1 slice, 1 large egg' : 'e.g. 170g, 1 slice, 1 scoop'}
                  required
                />
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                  {form.tracking_type === 'unit'
                    ? 'The human-readable label shown to you when logging.'
                    : 'The human-readable label as printed on the package.'}
                </p>
              </div>
              {form.tracking_type !== 'unit' && (
                <div>
                  <label>Grams per serving <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(for scaling)</span></label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={scanFieldClass(labelScanFieldStatus?.grams_per_serving)}
                    value={form.grams_per_serving}
                    onChange={e => {
                      clearScanHints();
                      setForm(f => ({ ...f, grams_per_serving: e.target.value }));
                    }}
                    placeholder="e.g. 170"
                  />
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                    Used by Meal Builder to scale portions by weight.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Nutrition per serving ── */}
          <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
            <h4 style={{
              margin: '0 0 12px', fontSize: 15, fontWeight: 400,
              color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
            }}>Nutrition per serving</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                <label>Fiber (g) <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
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
            {editing ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm());
                  clearLabelPhoto();
                }}
              >
                Cancel
              </button>
            ) : (
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
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save ingredient'}
            </button>
          </div>

        </form>
      </div>

      <div className="card">
        <h3 style={{
          marginTop: 0, fontSize: 20, fontWeight: 400,
          color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
        }}>Your ingredients</h3>
        <label htmlFor="ingredient-search" style={{ marginBottom: 4 }}>Search</label>
        <input
          id="ingredient-search"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, brand, or base label…"
          autoComplete="off"
          style={{ marginBottom: 12 }}
        />
        {filtered.length === 0 ? (
          <p className="empty-state">{items.length === 0 ? 'No ingredients yet.' : 'No ingredients match your search.'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderBottom: '1px solid #f3f4f6', paddingBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{i.name}</strong>
                  {i.brand_name ? <span style={{ color: '#6b7280', marginLeft: 8 }}>({i.brand_name})</span> : null}
                  {i.base_label ? <span style={{ color: '#9ca3af', marginLeft: 8 }}>{i.base_label}</span> : null}
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {i.tracking_type === 'unit' && i.unit_name
                      ? <>per {i.serving_quantity != null ? i.serving_quantity : 1} {i.unit_name}</>
                      : <>{i.serving_size_text}{i.grams_per_serving != null ? ` · ${i.grams_per_serving}g/serving` : ''}</>
                    }
                    {' · '}{i.calories} cal
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" onClick={() => startEdit(i)}>Edit</button>
                  <button
                    type="button"
                    className="btn-danger"
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
          </div>
        )}
      </div>

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
    </div>
  );
}

