import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  deleteGymSet,
  fetchGymActivityTypes,
  fetchGymTemplates,
  fetchGymToday,
  logGymSet,
  startGymSession,
  updateGymSession,
} from '@shared/api/gym';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import Reveal from '@shared/ui/Reveal';
import RestTimer from '../components/RestTimer';
import SetKeypad from '../components/SetKeypad';
import styles from '../Gym.module.css';

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function lastWorking(sets, exerciseId) {
  return [...sets].reverse().find(s => s.exercise_id === exerciseId && !s.is_warmup) || null;
}

export default function GymToday() {
  const { bodyUnits } = useMacroUnits();
  const unit = bodyUnits === 'us' ? 'lb' : 'kg';
  const date = getLocalDateISO();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [pickId, setPickId] = useState('');
  const [activity, setActivity] = useState('tennis');
  const [error, setError] = useState('');
  const [keypad, setKeypad] = useState(null);
  const [rest, setRest] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const reload = useCallback(() => {
    return fetchGymToday(date).then(setData);
  }, [date]);

  useEffect(() => {
    Promise.all([reload(), fetchGymTemplates(), fetchGymActivityTypes()])
      .then(([, t, a]) => { setTemplates(t); setActivities(a); })
      .catch(e => setError(e.message));
  }, [reload]);

  const session = data?.session;
  const live = session && !session.ended_at;

  useEffect(() => {
    if (!live || !session?.started_at) return undefined;
    const started = Date.parse(session.started_at);
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [live, session?.started_at]);

  const templateChoice = pickId
    || (data?.template?.id ? String(data.template.id) : '')
    || (data?.schedule?.template_id ? String(data.schedule.template_id) : '');

  const sets = session?.sets || [];
  const exercises = data?.template?.exercises || [];

  async function start(kind = 'strength') {
    setError('');
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      await startGymSession({
        date,
        template_id: kind === 'strength' && templateChoice ? Number(templateChoice) : undefined,
        activity_type: kind,
      });
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function finish() {
    if (!session) return;
    await updateGymSession(session.id, { finish: true, duration_sec: elapsed, activity_type: activity });
    setRest(null);
    await reload();
  }

  async function logSet(exercise, payload, restSec) {
    await logGymSet(session.id, {
      exercise_id: exercise.exercise_id || exercise.id,
      weight_unit: unit,
      ...payload,
    });
    setKeypad(null);
    if (!payload.is_warmup && restSec) setRest(restSec);
    await reload();
  }

  async function repeat(exercise) {
    const prev = lastWorking(sets, exercise.exercise_id) || exercise.previous?.[0];
    if (!prev) return;
    await logSet(exercise, { reps: prev.reps, weight: prev.weight, is_warmup: false }, exercise.rest_sec);
  }

  return (
    <div>
      <Reveal className={styles.toolbar}>
        <div>
          <h2 className="section-title">Today</h2>
          <p className={styles.lede}>
            {data?.template?.name || data?.schedule?.template_name || 'No workout scheduled'}
            {live ? <span className={styles.clock}> · {fmtClock(elapsed)}</span> : null}
          </p>
        </div>
        {live ? (
          <button type="button" className="btn-primary" onClick={() => void finish()}>Finish</button>
        ) : null}
      </Reveal>
      {error && <p className="error">{error}</p>}

      {rest != null && live && (
        <RestTimer key={`${session?.id}-${sets.length}-${rest}`} seconds={rest} onSkip={() => setRest(null)} />
      )}

      {!session && (
        <div className="card">
          {templates.length === 0 ? (
            <p className="empty-state" style={{ padding: '12px 0' }}>
              Build a workout in <Link to="/training/workouts">Workouts</Link>, then start logging sets.
            </p>
          ) : (
            <>
              <label>Workout
                <select value={templateChoice} onChange={e => setPickId(e.target.value)}>
                  <option value="">Choose…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button type="button" className="btn-primary" disabled={!templateChoice} onClick={() => { setActivity('strength'); void start('strength'); }}>
                  Start workout
                </button>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--color-divider-warm)', margin: '18px 0' }} />
              <label>Or log an activity
                <select value={activity} onChange={e => setActivity(e.target.value)}>
                  {activities.filter(a => a.id !== 'strength').map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn-secondary" onClick={() => void start(activity)}>
                  Start {activities.find(a => a.id === activity)?.label || 'activity'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {session && session.activity_type && session.activity_type !== 'strength' && (
        <div className="card">
          <strong>{activities.find(a => a.id === session.activity_type)?.label || session.activity_type}</strong>
          <p className={styles.lede} style={{ marginTop: 6 }}>{fmtClock(elapsed)}</p>
          {!session.ended_at && (
            <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => void finish()}>
              Save duration
            </button>
          )}
          {session.ended_at && (
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)' }}>
              Saved {fmtClock(session.duration_sec)}.
            </p>
          )}
        </div>
      )}

      {session && (session.activity_type === 'strength' || !session.activity_type) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data?.template?.progression_notes && (
            <p className={styles.lede}>{data.template.progression_notes}</p>
          )}
          {exercises.length === 0 && (
            <p className="empty-state">This workout has no exercises yet.</p>
          )}
          {exercises.map(ex => {
            const mine = sets.filter(s => s.exercise_id === ex.exercise_id);
            const prev = ex.previous?.[0];
            return (
              <div key={ex.id} className="card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{ex.name}</strong>
                    <div className={styles.prev}>
                      Target {ex.target_sets || '–'} × {ex.target_reps || '–'}
                      {ex.target_weight != null ? ` @ ${ex.target_weight}` : ''}
                      {prev ? ` · last ${prev.reps} × ${prev.weight}${prev.weight_unit || ''}` : ' · no previous'}
                    </div>
                  </div>
                  {live && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn-secondary" onClick={() => void repeat(ex)} disabled={!lastWorking(sets, ex.exercise_id) && !prev}>
                        Repeat set
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setKeypad({
                          exercise: ex,
                          reps: lastWorking(sets, ex.exercise_id)?.reps ?? ex.target_reps ?? prev?.reps ?? '',
                          weight: lastWorking(sets, ex.exercise_id)?.weight ?? ex.target_weight ?? prev?.weight ?? '',
                        })}
                      >
                        Log set
                      </button>
                    </div>
                  )}
                </div>
                {mine.map(s => (
                  <div key={s.id} className={styles.setLine}>
                    <span>
                      Set {s.set_index}{s.is_warmup ? ' (warmup)' : ''} · {s.reps ?? '–'} reps · {s.weight ?? '–'} {s.weight_unit || unit}
                      {s.note ? ` · ${s.note}` : ''}
                    </span>
                    {live && (
                      <button type="button" className="btn-danger-ghost" style={{ minHeight: 32, fontSize: 12 }} onClick={() => void deleteGymSet(session.id, s.id).then(reload)}>
                        Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {keypad && (
        <SetKeypad
          title={keypad.exercise.name}
          initialReps={keypad.reps}
          initialWeight={keypad.weight}
          unit={unit}
          onClose={() => setKeypad(null)}
          onConfirm={payload => void logSet(keypad.exercise, payload, keypad.exercise.rest_sec).catch(e => setError(e.message))}
        />
      )}
    </div>
  );
}
