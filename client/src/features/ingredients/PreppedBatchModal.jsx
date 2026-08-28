import { useEffect, useRef, useState } from 'react';
import { createPreppedBatch } from '@shared/api/preppedBatches';

/**
 * Create a cooked batch with fixed total weight + macros.
 */
export default function PreppedBatchModal({ onClose, onSaved }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [calories, setCalories] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [fiberG, setFiberG] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      await createPreppedBatch({
        name: name.trim(),
        total_weight_g: Number(totalWeightG),
        total_calories: Number(calories),
        total_protein_g: Number(proteinG),
        total_carbs_g: Number(carbsG),
        total_fat_g: Number(fatG),
        total_fiber_g: fiberG !== '' ? Number(fiberG) : 0,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save batch.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} style={{ width: 'min(480px, 94vw)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Prep a batch</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
        Cooked a batch with fixed macros? Log by weight until it&apos;s gone.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="prep-name">Name</label>
        <input id="prep-name" value={name} onChange={e => setName(e.target.value)} required style={{ marginBottom: 10 }} />

        <label htmlFor="prep-weight">Total cooked weight (g)</label>
        <input id="prep-weight" type="number" min="1" step="any" value={totalWeightG} onChange={e => setTotalWeightG(e.target.value)} required style={{ marginBottom: 10 }} />

        <div className="form-grid-2" style={{ marginBottom: 10 }}>
          <div>
            <label htmlFor="prep-cal">Total calories</label>
            <input id="prep-cal" type="number" min="0" step="any" value={calories} onChange={e => setCalories(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="prep-protein">Total protein (g)</label>
            <input id="prep-protein" type="number" min="0" step="any" value={proteinG} onChange={e => setProteinG(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="prep-carbs">Total carbs (g)</label>
            <input id="prep-carbs" type="number" min="0" step="any" value={carbsG} onChange={e => setCarbsG(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="prep-fat">Total fat (g)</label>
            <input id="prep-fat" type="number" min="0" step="any" value={fatG} onChange={e => setFatG(e.target.value)} required />
          </div>
        </div>

        <label htmlFor="prep-fiber">Total fiber (g, optional)</label>
        <input id="prep-fiber" type="number" min="0" step="any" value={fiberG} onChange={e => setFiberG(e.target.value)} style={{ marginBottom: 12 }} />

        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={saving ? 'btn-primary btn-loading' : 'btn-primary'} disabled={saving}>
            {saving ? 'Saving…' : 'Save batch'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
