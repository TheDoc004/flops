import { scanFieldClass } from '@features/label-ocr';
import { SERVING_UNITS, isWeightUnit, unitLabel } from '@shared/utils/servingBasis';
import ServingUnitsHint from '@shared/ui/ServingUnitsHint';

/**
 * Optional detour off the build step — add a missing ingredient to the
 * library, then return to the meal in progress. Not part of the main
 * build → save flow.
 */
export default function StepIngredients({
  labelDraft,
  setLabelDraft,
  ocrBusy,
  onPickLabelPhoto,
  onRunOcr,
  onOpenCrop,
  labelScanFeedback,
  labelScanFieldStatus,
  clearLabelScanHints,
  onSaveIngredient,
  onClearForm,
  labelSaveError,
  lastSavedIngredientName,
  onDone,
}) {
  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 16 }}>Add a new ingredient</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Label photo</label>
          <input type="file" accept="image/*" onChange={onPickLabelPhoto} />
          {labelDraft.photoPreview && (
            <div style={{ marginTop: 10 }}>
              <img src={labelDraft.photoPreview} alt="Label preview" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className={ocrBusy ? 'btn-secondary btn-loading' : 'btn-secondary'} disabled={ocrBusy} onClick={onRunOcr}>
                  {ocrBusy ? (<><span className="btn-spinner" aria-hidden="true" />Reading…</>) : 'Read label (OCR)'}
                </button>
                <button type="button" className="btn-secondary" onClick={onOpenCrop}>
                  Crop to nutrition panel
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

        <form onSubmit={onSaveIngredient} className="form-grid-2">
          {/* Name + brand */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Product / ingredient name</label>
            <input value={labelDraft.name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, name: e.target.value })); }} placeholder="e.g. Greek yogurt" required />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Brand <span style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
            <input value={labelDraft.brand_name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, brand_name: e.target.value })); }} placeholder="e.g. Fage, Chobani" />
          </div>

          {/* Serving & scaling */}
          <div style={{ gridColumn: '1 / -1', paddingTop: 12, borderTop: '1px solid #f0ede8' }}>
            <div style={{ marginBottom: 4, fontSize: 15, fontWeight: 600, color: 'var(--color-text-body)' }}>Serving &amp; scaling</div>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              As printed on the label — 170 g, 1 cup, 1 scoop…
            </p>
          </div>
          <div>
            <label htmlFor="mb-serving-amount">Serving amount</label>
            <input
              id="mb-serving-amount"
              type="number" min="0" step="0.01"
              className={scanFieldClass(labelScanFieldStatus?.grams_per_serving)}
              value={labelDraft.serving_amount}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, serving_amount: e.target.value })); }}
              placeholder="1"
            />
          </div>
          <div>
            <label htmlFor="mb-serving-unit">Serving unit</label>
            <select
              id="mb-serving-unit"
              value={labelDraft.serving_unit}
              onChange={e => setLabelDraft(d => ({ ...d, serving_unit: e.target.value }))}
            >
              {SERVING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              <option value="custom">custom…</option>
            </select>
          </div>
          {labelDraft.serving_unit === 'custom' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="mb-unit-custom">Unit name</label>
              <input
                id="mb-unit-custom"
                value={labelDraft.serving_unit_custom}
                onChange={e => setLabelDraft(d => ({ ...d, serving_unit_custom: e.target.value }))}
                placeholder="e.g. bar, packet, bagel"
              />
            </div>
          )}
          {!isWeightUnit(labelDraft.serving_unit) && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="mb-gram-equiv">
                1 {unitLabel(labelDraft)} = grams <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="mb-gram-equiv"
                type="number" min="0" step="0.01"
                value={labelDraft.gram_equivalent}
                onChange={e => setLabelDraft(d => ({ ...d, gram_equivalent: e.target.value }))}
                placeholder="e.g. 31"
              />
              <ServingUnitsHint serving={labelDraft} unitName={unitLabel(labelDraft)} />
            </div>
          )}

          {/* Macros */}
          <div className="form-grid-2" style={{ gridColumn: '1 / -1' }}>
            <div>
              <label>Calories</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.calories)} value={labelDraft.calories} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, calories: e.target.value })); }} required />
            </div>
            <div>
              <label>Protein (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.protein_g)} value={labelDraft.protein_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, protein_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Carbs (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.carbs_g)} value={labelDraft.carbs_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, carbs_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Fat (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.fat_g)} value={labelDraft.fat_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fat_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Fiber (g) <span style={{ fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.fiber_g)} value={labelDraft.fiber_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fiber_g: e.target.value })); }} placeholder="Optional" />
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary">Save ingredient</button>
            <button type="button" className="btn-secondary" onClick={onClearForm}>
              Clear form
            </button>
          </div>
        </form>
        {labelSaveError && <p className="error">{labelSaveError}</p>}
        {lastSavedIngredientName && (
          <p style={{ color: 'var(--color-success)', fontSize: 14, marginBottom: 0 }}>
            Saved <strong>{lastSavedIngredientName}</strong> to your library — it&apos;s ready to use in the next step.
          </p>
        )}
      </div>

      <div className="wizard-nav">
        <button type="button" className="btn-primary wizard-continue" onClick={onDone}>
          Done — back to your meal →
        </button>
      </div>
    </>
  );
}
