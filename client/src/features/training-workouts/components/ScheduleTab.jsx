import { useEffect, useMemo, useState } from 'react';
import {
  fetchTrainingSchedule,
  saveTrainingSchedule,
} from '@shared/api/training';
import { parseLocalDateISO } from '@shared/utils/dateLocal';
import {
  ISO_WEEKDAY_LABELS,
  SUNDAY_FIRST_WEEKDAYS,
  getIsoWeekday,
} from '@shared/utils/weekday';
import Reveal from '@shared/ui/Reveal';

// time_min (minutes past midnight) <-> "HH:MM" for the native time input.
function minToHHMM(min) {
  if (min == null || min === '') return '';
  const h = Math.floor(Number(min) / 60);
  const m = Number(min) % 60;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function hhmmToMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Blank editable row for a weekday with no saved schedule yet.
function emptyRow(weekday) {
  return {
    weekday,
    enabled: 0,
    time_min: null,
    workout_type: null,
    duration_min: null,
    preset_id: null,
  };
}

/**
 * Weekly recurring training plan. Seven days, each either a rest day or a
 * training day linked to a workout preset (+ optional time & duration). Saves
 * all seven at once via PUT /api/training/schedule.
 */
export default function ScheduleTab({ presets = [], today, onNotify }) {
  const [rows, setRows] = useState(() => SUNDAY_FIRST_WEEKDAYS.map(emptyRow));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const todayWeekday = useMemo(
    () => (today ? getIsoWeekday(parseLocalDateISO(today)) : null),
    [today]
  );

  useEffect(() => {
    let cancelled = false;
    fetchTrainingSchedule()
      .then(data => {
        if (cancelled) return;
        const byDay = Object.fromEntries((data?.schedule || []).map(r => [r.weekday, r]));
        setRows(SUNDAY_FIRST_WEEKDAYS.map(wd => byDay[wd] || emptyRow(wd)));
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function updateRow(weekday, patch) {
    setRows(prev => prev.map(r => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const schedule = rows.map(r => ({
        weekday: r.weekday,
        enabled: r.enabled ? 1 : 0,
        time_min: r.enabled ? hhmmToMin(minToHHMM(r.time_min)) : null,
        workout_type: r.workout_type ?? null,
        duration_min: r.enabled && r.duration_min !== '' ? r.duration_min : null,
        preset_id: r.enabled ? r.preset_id ?? null : null,
      }));
      await saveTrainingSchedule(schedule);
      // Refetch so preset_name / normalized values reflect what was stored.
      const data = await fetchTrainingSchedule();
      const byDay = Object.fromEntries((data?.schedule || []).map(r => [r.weekday, r]));
      setRows(SUNDAY_FIRST_WEEKDAYS.map(wd => byDay[wd] || emptyRow(wd)));
      onNotify?.('Schedule saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const trainingDays = rows.filter(r => r.enabled).length;

  if (loading) return <p className="empty-state" style={{ padding: '32px 0' }}>Loading schedule…</p>;

  return (
    <div>
      <Reveal className="card" style={{ marginBottom: 16 }} delay={120}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: '0 0 2px' }}>Weekly schedule</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
              Your recurring plan — {trainingDays} training {trainingDays === 1 ? 'day' : 'days'} per week.
            </p>
          </div>
        </div>
      </Reveal>

      {error && <p className="error">{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(row => {
          const isToday = row.weekday === todayWeekday;
          return (
            <div
              key={row.weekday}
              className="card"
              style={{
                marginBottom: 0,
                padding: '14px 16px',
                borderLeft: `3px solid ${row.enabled ? '#2563eb' : '#e5e7eb'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
                  <strong style={{ fontSize: 15 }}>{ISO_WEEKDAY_LABELS[row.weekday]}</strong>
                  {isToday && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff6ff', borderRadius: 999, padding: '1px 8px' }}>
                      Today
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => updateRow(row.weekday, { enabled: row.enabled ? 0 : 1 })}
                  style={{
                    marginLeft: 'auto',
                    minHeight: 36,
                    padding: '6px 16px',
                    borderRadius: 999,
                    border: '1px solid',
                    borderColor: row.enabled ? '#2563eb' : '#d1d5db',
                    background: row.enabled ? '#2563eb' : 'white',
                    color: row.enabled ? 'white' : '#6b7280',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {row.enabled ? 'Training day' : 'Rest day'}
                </button>
              </div>

              {row.enabled === 1 && (
                <div
                  style={{
                    marginTop: 12,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div>
                    <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Workout</label>
                    <select
                      value={row.preset_id ?? ''}
                      onChange={e => updateRow(row.weekday, { preset_id: e.target.value === '' ? null : Number(e.target.value) })}
                      style={{ width: '100%' }}
                    >
                      <option value="">— Not set —</option>
                      {presets.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.intensity_label ? ` (${p.intensity_label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Time</label>
                    <input
                      type="time"
                      value={minToHHMM(row.time_min)}
                      onChange={e => updateRow(row.weekday, { time_min: hhmmToMin(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, marginBottom: 4, display: 'block', color: '#6b7280' }}>Duration (min)</label>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={row.duration_min ?? ''}
                      onChange={e => updateRow(row.weekday, { duration_min: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="e.g. 60"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type="button"
          className={saving ? 'btn-primary btn-loading' : 'btn-primary'}
          style={{ minHeight: 44, padding: '0 28px' }}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}
