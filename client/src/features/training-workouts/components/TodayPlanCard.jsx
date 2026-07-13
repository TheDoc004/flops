import { useEffect, useMemo, useState } from 'react';
import {
  deleteTrainingOverride,
  fetchTrainingToday,
  saveTrainingOverride,
} from '@shared/api/training';
import { parseLocalDateISO } from '@shared/utils/dateLocal';
import { getIsoWeekday } from '@shared/utils/weekday';

function minToHHMM(min) {
  if (min == null || min === '') return '';
  const h = Math.floor(Number(min) / 60);
  const m = Number(min) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function hhmmToMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

const SOURCE_NOTE = {
  override: 'Adjusted just for today',
  schedule: 'From your weekly schedule',
  none: null,
};

/**
 * Shows today's resolved plan (override → schedule → none) and lets the user
 * set or clear a one-off override for this date. Distinct from the preset
 * picker below it: this is the plan (train/rest, time, duration); that is which
 * workout you log.
 */
export default function TodayPlanCard({ date, onNotify }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ enabled: 1, time_hhmm: '', duration_min: '', workout_type: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const weekday = useMemo(() => getIsoWeekday(parseLocalDateISO(date)), [date]);

  async function reload() {
    const p = await fetchTrainingToday({ date, weekday });
    setPlan(p);
    return p;
  }

  useEffect(() => {
    let cancelled = false;
    fetchTrainingToday({ date, weekday })
      .then(p => { if (!cancelled) setPlan(p); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, weekday]);

  function openEditor() {
    setDraft({
      enabled: plan?.enabled ? 1 : (plan?.source === 'none' ? 1 : 0),
      time_hhmm: minToHHMM(plan?.time_min),
      duration_min: plan?.duration_min ?? '',
      workout_type: plan?.workout_type ?? '',
    });
    setEditing(true);
  }

  async function handleSaveOverride() {
    setBusy(true);
    setError('');
    try {
      await saveTrainingOverride({
        date,
        enabled: draft.enabled ? 1 : 0,
        time_min: draft.enabled ? hhmmToMin(draft.time_hhmm) : null,
        duration_min: draft.enabled && draft.duration_min !== '' ? Number(draft.duration_min) : null,
        workout_type: draft.enabled ? (draft.workout_type.trim() || null) : null,
      });
      await reload();
      setEditing(false);
      onNotify?.('Today adjusted.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert() {
    setBusy(true);
    setError('');
    try {
      await deleteTrainingOverride(date);
      await reload();
      setEditing(false);
      onNotify?.('Reverted to your schedule.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  const note = plan ? SOURCE_NOTE[plan.source] : null;
  const summary = !plan || !plan.enabled
    ? 'Rest day'
    : [plan.preset_name || plan.workout_type || 'Training', plan.time_hhmm, plan.duration_min ? `${plan.duration_min} min` : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${plan?.enabled ? '#2563eb' : '#e5e7eb'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#6b7280' }}>
            Today’s plan
          </p>
          <strong style={{ fontSize: 16 }}>{summary}</strong>
          {note && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>{note}</p>}
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {plan?.source === 'override' && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 13, padding: '7px 14px', minHeight: 36 }}
                onClick={() => void handleRevert()}
                disabled={busy}
              >
                Revert to schedule
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 13, padding: '7px 14px', minHeight: 36 }}
              onClick={openEditor}
            >
              Adjust for today
            </button>
          </div>
        )}
      </div>

      {error && <p className="error" style={{ marginTop: 10, marginBottom: 0 }}>{error}</p>}

      {editing && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {[[1, 'Training'], [0, 'Rest day']].map(([val, label]) => {
              const active = draft.enabled === val;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, enabled: val }))}
                  style={{
                    flex: '1 1 0',
                    minHeight: 40,
                    borderRadius: 9,
                    border: '1px solid',
                    borderColor: active ? '#2563eb' : '#d1d5db',
                    background: active ? '#2563eb' : 'white',
                    color: active ? 'white' : '#374151',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {draft.enabled === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Type (optional)</label>
                <input
                  value={draft.workout_type}
                  onChange={e => setDraft(d => ({ ...d, workout_type: e.target.value.slice(0, 64) }))}
                  placeholder="e.g. Easy cardio"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Time</label>
                <input
                  type="time"
                  value={draft.time_hhmm}
                  onChange={e => setDraft(d => ({ ...d, time_hhmm: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Duration (min)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={draft.duration_min}
                  onChange={e => setDraft(d => ({ ...d, duration_min: e.target.value === '' ? '' : Number(e.target.value) }))}
                  placeholder="e.g. 45"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 40 }}
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={busy ? 'btn-primary btn-loading' : 'btn-primary'}
              style={{ minHeight: 40, padding: '0 20px' }}
              onClick={() => void handleSaveOverride()}
              disabled={busy}
            >
              {busy ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : 'Save for today'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
