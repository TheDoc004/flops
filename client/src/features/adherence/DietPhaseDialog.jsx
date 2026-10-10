import { useEffect, useRef, useState } from 'react';
import { createDietPhase, updateDietPhase, deleteDietPhase } from '@shared/api/dietPhases';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { PHASE_KINDS, PHASE_META, guessPhaseKind } from './phaseMeta';

/**
 * Add or edit a diet-phase badge ("started a cut", "maintenance week"). The
 * name is free text; the color is optional and follows the name until the
 * user picks one.
 * `phase` null → create, seeded with `defaultStart`. Leaving "Ongoing" checked
 * stores no end date: the phase runs until the next ongoing one starts.
 */
export default function DietPhaseDialog({ phase = null, defaultStart = null, onClose, onSaved }) {
  const ref = useRef(null);
  const isEdit = !!phase?.id;
  const [kind, setKind] = useState(phase?.kind || 'other');
  // An existing phase keeps its color; a new one guesses from the name.
  const [kindPicked, setKindPicked] = useState(isEdit);
  const [label, setLabel] = useState(phase?.label || '');
  const [startDate, setStartDate] = useState(phase?.start_date || defaultStart || getLocalDateISO());
  const [ongoing, setOngoing] = useState(!phase?.end_date);
  const [endDate, setEndDate] = useState(phase?.end_date || '');
  const [notes, setNotes] = useState(phase?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (busy) return;
    if (!label.trim()) return setError('Give the badge a name.');
    if (!startDate) return setError('Pick a start date.');
    if (!ongoing && !endDate) return setError('Pick an end date, or mark the phase ongoing.');
    if (!ongoing && endDate < startDate) return setError('The end date is before the start date.');
    setBusy(true);
    setError('');
    const body = {
      kind,
      label: label.trim(),
      start_date: startDate,
      end_date: ongoing ? null : endDate,
      notes: notes.trim() || null,
    };
    try {
      if (isEdit) await updateDietPhase(phase.id, body);
      else await createDietPhase(body);
      onSaved?.();
      ref.current?.close();
    } catch (err) {
      setError(err.message || 'Could not save the phase.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteDietPhase(phase.id);
      onSaved?.();
      ref.current?.close();
    } catch (err) {
      setError(err.message || 'Could not delete the phase.');
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} style={{ width: 'min(440px, 94vw)' }}>
      <form onSubmit={handleSave}>
        <h2 className="section-title" style={{ margin: '0 0 4px' }}>
          {isEdit ? 'Edit diet phase' : 'Mark a diet phase'}
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          A badge on your calendar for when you changed course. It doesn&apos;t change your goals.
        </p>

        <label htmlFor="phase-label">Name</label>
        <input
          id="phase-label"
          value={label}
          maxLength={60}
          required
          autoFocus={!isEdit}
          onChange={e => {
            setLabel(e.target.value);
            if (!kindPicked) setKind(guessPhaseKind(e.target.value));
          }}
          placeholder="e.g. Bulk, Summer cut, Deload week"
        />

        <span style={{ display: 'block', marginTop: 12, marginBottom: 4, fontSize: 'var(--text-secondary)', fontWeight: 500, color: 'var(--color-text-body)' }}>
          Color (optional)
        </span>
        <div role="radiogroup" aria-label="Badge color" className="phase-kind-picker">
          {PHASE_KINDS.map(k => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'phase-kind is-on' : 'phase-kind'}
              style={{ '--phase-color': PHASE_META[k].color }}
              onClick={() => { setKind(k); setKindPicked(true); }}
            >
              <span className="cal-phase-chip__dot" aria-hidden="true" />
              {PHASE_META[k].label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label htmlFor="phase-start">Starts</label>
            <input id="phase-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label htmlFor="phase-end">Ends</label>
            <input
              id="phase-end"
              type="date"
              value={ongoing ? '' : endDate}
              min={startDate || undefined}
              disabled={ongoing}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={ongoing} onChange={e => setOngoing(e.target.checked)} />
          Ongoing, until I start another phase
        </label>

        <label htmlFor="phase-notes" style={{ marginTop: 12 }}>Notes (optional)</label>
        <textarea
          id="phase-notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. +250 kcal surplus, aiming for 0.25 kg/week"
          style={{ fontFamily: 'inherit', resize: 'vertical' }}
        />

        {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {isEdit && (
            <button type="button" className="btn-danger-ghost" onClick={handleDelete} disabled={busy}>
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {isEdit ? 'Save' : 'Add phase'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
