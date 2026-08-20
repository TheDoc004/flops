import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCustomLog } from '@shared/api/log';
import {
  fetchPrep,
  createPrepItem,
  patchPrepItem,
  dismissPrepItem,
} from '@shared/api/prep';
import {
  fetchMySuggestions,
  patchSuggestion,
} from '@shared/api/coach';

function macrosOf(p) {
  const cal = Number(p.calories) || 0;
  const protein = Number(p.protein_g) || 0;
  const carbs = Number(p.carbs_g) || 0;
  const fat = Number(p.fat_g) || 0;
  const servings = Number(p.servings) > 0 ? Number(p.servings) : 1;
  return {
    calories: cal * servings,
    protein_g: protein * servings,
    carbs_g: carbs * servings,
    fat_g: fat * servings,
  };
}

/**
 * Soft plan-ahead + coach suggestion strip for a viewing date.
 * Prep items are drafts; logging copies into the client's own notebook.
 */
export default function PrepStrip({ date, onLogged }) {
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    servings: '1',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
  });

  const load = useCallback(async () => {
    setError('');
    try {
      const [prep, sug] = await Promise.all([
        fetchPrep(date),
        fetchMySuggestions(date).catch(() => []),
      ]);
      setItems(Array.isArray(prep) ? prep : []);
      setSuggestions(Array.isArray(sug) ? sug : []);
    } catch (e) {
      setError(e.message);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const planned = items.filter(i => i.status === 'planned' || i.status === 'hidden');
  const visible = planned.filter(i => i.status !== 'hidden');

  const plannedTotals = useMemo(() => {
    return visible.reduce(
      (acc, i) => {
        const m = macrosOf(i.payload || {});
        return {
          calories: acc.calories + m.calories,
          protein_g: acc.protein_g + m.protein_g,
          carbs_g: acc.carbs_g + m.carbs_g,
          fat_g: acc.fat_g + m.fat_g,
        };
      },
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );
  }, [visible]);

  async function addItem(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createPrepItem(date, {
        name: draft.name.trim(),
        servings: Number(draft.servings) || 1,
        calories: draft.calories === '' ? null : Number(draft.calories),
        protein_g: draft.protein_g === '' ? null : Number(draft.protein_g),
        carbs_g: draft.carbs_g === '' ? null : Number(draft.carbs_g),
        fat_g: draft.fat_g === '' ? null : Number(draft.fat_g),
      });
      setDraft({ name: '', servings: '1', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(item) {
    setBusy(true);
    try {
      await patchPrepItem(item.id, {
        status: item.status === 'hidden' ? 'planned' : 'hidden',
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function logItem(item) {
    setBusy(true);
    setError('');
    try {
      const p = item.payload || {};
      await createCustomLog({
        date,
        name: p.name || 'Prep item',
        servings: Number(p.servings) > 0 ? Number(p.servings) : 1,
        calories: Number(p.calories) || 0,
        protein_g: Number(p.protein_g) || 0,
        carbs_g: Number(p.carbs_g) || 0,
        fat_g: Number(p.fat_g) || 0,
        notes: p.notes || undefined,
      });
      await patchPrepItem(item.id, { status: 'logged' });
      await load();
      if (onLogged) await onLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function softDismiss(item) {
    setBusy(true);
    try {
      await dismissPrepItem(item.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion(s, status) {
    setBusy(true);
    setError('');
    try {
      await patchSuggestion(s.id, { status, payload: s.payload });
      await load();
      if (status === 'applied' && onLogged) await onLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>Prep / plan</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Soft drafts for this day — toggle, tweak, or log when you eat them.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setShowAdd(v => !v)} disabled={busy}>
          {showAdd ? 'Cancel' : '+ Prep food'}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

      {showAdd && (
        <form onSubmit={addItem} style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <input
            required
            placeholder="Food name (e.g. cooked rice)"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
            {[
              ['servings', 'Servings'],
              ['calories', 'kcal'],
              ['protein_g', 'Protein'],
              ['carbs_g', 'Carbs'],
              ['fat_g', 'Fat'],
            ].map(([key, label]) => (
              <label key={key} style={{ fontSize: 12 }}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !draft.name.trim()}>
            Add to prep
          </button>
        </form>
      )}

      {suggestions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#374151' }}>From your coach</h4>
          {suggestions.map(s => (
            <div
              key={s.id}
              style={{
                border: '1px solid #bfdbfe',
                background: s.status === 'snoozed' ? '#fafafa' : 'var(--color-primary-subtle)',
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary-ink)' }}>
                {s.coach_name || 'Coach'}
                {s.note ? ` · ${s.note}` : ''}
              </div>
              <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 13 }}>
                {(s.payload?.slots || []).map((slot, i) => (
                  <li key={i}>
                    {slot.name || slot.label || 'Item'}
                    {slot.servings != null ? ` × ${slot.servings}` : ''}
                    {slot.protein_g != null ? ` · ${slot.protein_g}g P` : ''}
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => applySuggestion(s, 'applied')}>
                  Add to my prep
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => applySuggestion(s, 'snoozed')}>
                  Snooze
                </button>
                <button type="button" disabled={busy} onClick={() => applySuggestion(s, 'dismissed')}>
                  Dismiss
                </button>
                {s.status === 'snoozed' && (
                  <button type="button" disabled={busy} onClick={() => applySuggestion(s, 'offered')}>
                    Bring back
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 && planned.length === 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: '#9ca3af' }}>Nothing planned for this day yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
          {planned.map(item => {
            const p = item.payload || {};
            const hidden = item.status === 'hidden';
            return (
              <li
                key={item.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '10px 0',
                  borderTop: '1px solid #f0ebe3',
                  opacity: hidden ? 0.45 : 1,
                }}
              >
                <button
                  type="button"
                  aria-label={hidden ? 'Show again' : 'Hide'}
                  onClick={() => toggleHidden(item)}
                  disabled={busy}
                  style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e8e4dc', background: '#fff' }}
                >
                  {hidden ? '○' : '●'}
                </button>
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{p.name}</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {p.servings != null ? `${p.servings} serving(s)` : ''}
                    {p.calories != null ? ` · ${Math.round((Number(p.calories) || 0) * (Number(p.servings) || 1))} kcal` : ''}
                  </div>
                </div>
                {!hidden && (
                  <>
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => logItem(item)} style={{ minHeight: 36, padding: '6px 12px' }}>
                      Log it
                    </button>
                    <button type="button" disabled={busy} onClick={() => softDismiss(item)}>
                      Remove
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280' }}>
          Planned (visible): ~{Math.round(plannedTotals.calories)} kcal · P {Math.round(plannedTotals.protein_g * 10) / 10}g
          · C {Math.round(plannedTotals.carbs_g * 10) / 10}g · F {Math.round(plannedTotals.fat_g * 10) / 10}g
        </p>
      )}
    </div>
  );
}
