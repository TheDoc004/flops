import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import {
  addPresetExercise,
  createExerciseLog,
  createWorkoutPreset,
  deletePresetExercise,
  deleteWorkoutPreset,
  fetchExerciseLibrary,
  fetchExerciseProgress,
  fetchPresetExercises,
  fetchPreviousSessionLogs,
  fetchWorkoutPresets,
  fetchWorkoutToday,
  setWorkoutToday,
  updateWorkoutPreset,
} from '@shared/api/workouts';
import Reveal from '@shared/ui/Reveal';
import ChartReveal from '@shared/ui/ChartReveal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import ExerciseCombobox from './components/ExerciseCombobox';
import ScheduleTab from './components/ScheduleTab';
import FeedbackCard from './components/FeedbackCard';
import ExerciseTrend from './components/ExerciseTrend';
import TodayPlanCard from './components/TodayPlanCard';

// ── helpers ───────────────────────────────────────────────────────────────────

function weightUnit(bodyUnits) {
  return bodyUnits === 'us' ? 'lb' : 'kg';
}

function formatDateHeader(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

function TabBar({ active, onChange }) {
  const tabs = [
    { key: 'today', label: 'Today' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'workouts', label: 'Workouts' },
    { key: 'progress', label: 'Progress' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--color-secondary-bg)',
        borderRadius: 12,
        padding: 4,
        marginBottom: 20,
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          style={{
            padding: '10px 20px',
            minHeight: 44,
            border: 'none',
            borderRadius: 9,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            transition: 'background 0.15s, color 0.15s',
            background: active === t.key ? 'var(--color-surface)' : 'transparent',
            color: active === t.key ? 'var(--color-text-strong)' : 'var(--color-text-muted)',
            boxShadow: 'none',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ExerciseCard({ exercise, draft, prev, unit, onChangeDraft, onViewProgress }) {
  const d = draft || {};
  return (
    <div
      className="card"
      style={{ marginBottom: 0, padding: '16px 16px 14px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 16 }}>{exercise.name}</strong>
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: 13, padding: '7px 14px', minHeight: 36 }}
          onClick={() => onViewProgress(exercise.name)}
        >
          Progress
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 12 }}>
        <div>
          <label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>
            Weight ({unit})
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={d.weight ?? ''}
            onChange={e => onChangeDraft({ weight: e.target.value })}
            style={{ marginBottom: 4 }}
          />
          {prev?.weight != null && (
            <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>prev: {prev.weight}</div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>Reps</label>
          <input
            type="number"
            min="0"
            step="1"
            value={d.reps ?? ''}
            onChange={e => onChangeDraft({ reps: e.target.value })}
            style={{ marginBottom: 4 }}
          />
          {prev?.reps != null && (
            <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>prev: {prev.reps}</div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>Sets</label>
          <input
            type="number"
            min="0"
            step="1"
            value={d.sets ?? ''}
            onChange={e => onChangeDraft({ sets: e.target.value })}
            style={{ marginBottom: 4 }}
          />
          {prev?.sets != null && (
            <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>prev: {prev.sets}</div>
          )}
        </div>
      </div>

      <ExerciseTrend exercise={exercise.name} unit={unit} />
    </div>
  );
}

function ProgressChart({ exercise }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    if (!exercise) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchExerciseProgress(exercise)
      .then(r => { if (!cancelled) setRows(r || []); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [exercise]);

  const data = useMemo(
    () => rows.map(r => ({
      date: r.date,
      weight: r.weight == null ? null : Number(r.weight),
      reps: r.reps == null ? null : Number(r.reps),
    })),
    [rows]
  );

  if (!exercise) return null;
  if (loading) return <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading</p>;
  if (error) return <p className="error">{error}</p>;
  if (data.length === 0) {
    return <p className="empty-state">No logs yet for {exercise}.</p>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      <ChartReveal height={260}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="weight"
              stroke="#111827"
              strokeWidth={2}
              dot={false}
              name="Weight"
              isAnimationActive={!reduceMotion}
              animationDuration={250}
            />
            <Line
              type="monotone"
              dataKey="reps"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              name="Reps"
              isAnimationActive={!reduceMotion}
              animationDuration={250}
              animationBegin={reduceMotion ? 0 : 250}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartReveal>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function TrainingWorkouts() {
  const { bodyUnits } = useMacroUnits();
  const today = getLocalDateISO();
  const unit = weightUnit(bodyUnits);

  // shared
  const [activeTab, setActiveTab] = useState('today');
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  // today tab
  const [todaySel, setTodaySel] = useState({ preset_id: null, preset_name: null });
  const [todayPresetId, setTodayPresetId] = useState('');
  const [todayExercises, setTodayExercises] = useState([]);
  const [prevLogs, setPrevLogs] = useState({});
  const [logDrafts, setLogDrafts] = useState({});
  const [savingLogs, setSavingLogs] = useState(false);

  // workouts tab
  const [workoutsPresetId, setWorkoutsPresetId] = useState('');
  const [workoutsExercises, setWorkoutsExercises] = useState([]);
  const [newPreset, setNewPreset] = useState({ name: '', intensity_label: '', notes: '' });
  const [newExerciseName, setNewExerciseName] = useState('');
  const [library, setLibrary] = useState([]);
  const [editingPreset, setEditingPreset] = useState(null);

  // progress tab
  const [progressExercise, setProgressExercise] = useState('');
  const [progressInput, setProgressInput] = useState('');

  // ── initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [p, t, lib] = await Promise.all([
          fetchWorkoutPresets(),
          fetchWorkoutToday(today),
          fetchExerciseLibrary(),
        ]);
        if (cancelled) return;
        setPresets(p || []);
        setLibrary(lib || []);
        const sel = t || { preset_id: null, preset_name: null };
        setTodaySel(sel);
        if (sel.preset_id) setTodayPresetId(String(sel.preset_id));
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [today]);

  // load exercises + prev logs when today's preset changes
  useEffect(() => {
    if (!todayPresetId) {
      setTodayExercises([]);
      setPrevLogs({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ex = await fetchPresetExercises(todayPresetId);
        if (cancelled) return;
        setTodayExercises(ex || []);
        if (ex?.length) {
          const prev = await fetchPreviousSessionLogs(ex.map(e => e.name));
          if (!cancelled) setPrevLogs(prev || {});
        } else {
          setPrevLogs({});
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [todayPresetId]);

  // load exercises for workouts tab when preset selection changes
  useEffect(() => {
    if (!workoutsPresetId) { setWorkoutsExercises([]); return; }
    let cancelled = false;
    fetchPresetExercises(workoutsPresetId)
      .then(ex => { if (!cancelled) setWorkoutsExercises(ex || []); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [workoutsPresetId]);

  // ── derived ───────────────────────────────────────────────────────────────

  const workoutsSelectedPreset = useMemo(
    () => presets.find(p => String(p.id) === workoutsPresetId) || null,
    [presets, workoutsPresetId]
  );

  // ── handlers ──────────────────────────────────────────────────────────────

  function notify(msg) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 3000);
  }

  function setDraft(exName, patch) {
    setLogDrafts(prev => ({ ...prev, [exName]: { ...prev[exName], ...patch } }));
  }

  async function handleSelectTodayPreset(nextId) {
    setError('');
    const v = nextId === '' ? null : Number(nextId);
    try {
      const row = await setWorkoutToday(today, v);
      setTodaySel(row);
      setTodayPresetId(nextId);
      setLogDrafts({});
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSaveLogs() {
    if (!todayPresetId || todayExercises.length === 0) return;
    setSavingLogs(true);
    setError('');
    try {
      const jobs = [];
      for (const ex of todayExercises) {
        const d = logDrafts[ex.name] || {};
        const hasData = (d.weight != null && d.weight !== '')
          || (d.reps != null && d.reps !== '')
          || (d.sets != null && d.sets !== '');
        if (!hasData) continue;
        jobs.push(
          createExerciseLog({
            date: today,
            preset_id: Number(todayPresetId),
            exercise_name: ex.name,
            weight: d.weight === '' || d.weight == null ? null : Number(d.weight),
            weight_unit: unit,
            reps: d.reps === '' || d.reps == null ? null : Number(d.reps),
            sets: d.sets === '' || d.sets == null ? null : Number(d.sets),
          })
        );
      }
      await Promise.all(jobs);
      notify(jobs.length ? 'Saved.' : 'Nothing to save. Fill in at least one field.');
      if (jobs.length) {
        const prev = await fetchPreviousSessionLogs(todayExercises.map(e => e.name));
        setPrevLogs(prev || {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingLogs(false);
    }
  }

  async function handleCreatePreset(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await createWorkoutPreset({
        name: newPreset.name,
        intensity_label: newPreset.intensity_label || undefined,
        notes: newPreset.notes || undefined,
      });
      setNewPreset({ name: '', intensity_label: '', notes: '' });
      const p = await fetchWorkoutPresets();
      setPresets(p || []);
      if (r?.id) setWorkoutsPresetId(String(r.id));
      notify('Preset created.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdatePreset(e) {
    e.preventDefault();
    if (!editingPreset) return;
    setError('');
    try {
      await updateWorkoutPreset(editingPreset.id, {
        name: editingPreset.name,
        intensity_label: editingPreset.intensity_label || undefined,
        notes: editingPreset.notes || undefined,
      });
      setEditingPreset(null);
      setPresets(await fetchWorkoutPresets());
      notify('Preset updated.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeletePreset(preset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    setError('');
    try {
      await deleteWorkoutPreset(preset.id);
      const p = await fetchWorkoutPresets();
      setPresets(p || []);
      if (String(preset.id) === workoutsPresetId) setWorkoutsPresetId('');
      notify('Preset deleted.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddExercise(e) {
    e.preventDefault();
    if (!workoutsPresetId || !newExerciseName.trim()) return;
    setError('');
    try {
      await addPresetExercise(workoutsPresetId, { name: newExerciseName.trim() });
      setNewExerciseName('');
      setWorkoutsExercises(await fetchPresetExercises(workoutsPresetId));
      notify('Exercise added.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveExercise(ex) {
    setError('');
    try {
      await deletePresetExercise(ex.id);
      setWorkoutsExercises(await fetchPresetExercises(workoutsPresetId));
    } catch (err) {
      setError(err.message);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <Reveal style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Training</h1>
      </Reveal>

      {error && <p className="error">{error}</p>}
      {savedMsg && (
        <p style={{ color: '#059669', fontSize: 14, marginBottom: 12 }}>{savedMsg}</p>
      )}

      <Reveal delay={60}>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </Reveal>

      {/* ── TODAY TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'today' && (
        <div>
          <TodayPlanCard date={today} onNotify={notify} />
          <Reveal className="card" style={{ marginBottom: 16 }} delay={120}>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 13, color: '#6b7280' }}>
                  {formatDateHeader(today)}
                </p>
                <strong style={{ fontSize: 17 }}>
                  {todaySel.preset_name || 'No workout selected'}
                </strong>
              </div>
              <div style={{ minWidth: 180 }}>
                <select
                  aria-label="Change workout"
                  value={todayPresetId}
                  onChange={e => void handleSelectTodayPreset(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">No workout</option>
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.intensity_label ? ` (${p.intensity_label})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Reveal>

          {!todayPresetId ? (
            <p className="empty-state" style={{ padding: '32px 0' }}>
              Select a workout above to start logging.
            </p>
          ) : todayExercises.length === 0 ? (
            <p className="empty-state" style={{ padding: '32px 0' }}>
              No exercises in this preset. Add some in the Workouts tab.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {todayExercises.map(ex => (
                  <ExerciseCard
                    key={ex.id}
                    exercise={ex}
                    draft={logDrafts[ex.name]}
                    prev={prevLogs[ex.name]}
                    unit={unit}
                    onChangeDraft={patch => setDraft(ex.name, patch)}
                    onViewProgress={name => {
                      setProgressExercise(name);
                      setProgressInput(name);
                      setActiveTab('progress');
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  type="button"
                  className={savingLogs ? 'btn-primary btn-loading' : 'btn-primary'}
                  style={{ minHeight: 44, padding: '0 28px' }}
                  onClick={() => void handleSaveLogs()}
                  disabled={savingLogs}
                >
                  {savingLogs ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : "Save today's logs"}
                </button>
              </div>
              <FeedbackCard date={today} onNotify={notify} />
            </>
          )}
        </div>
      )}

      {/* ── SCHEDULE TAB ──────────────────────────────────────────────── */}
      {activeTab === 'schedule' && (
        <ScheduleTab presets={presets} today={today} onNotify={notify} />
      )}

      {/* ── WORKOUTS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'workouts' && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Preset list */}
          <Reveal delay={120} style={{ flex: '0 1 260px', minWidth: 220 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Workout presets</h3>

              {presets.length === 0 ? (
                <p className="empty-state" style={{ padding: '10px 0' }}>
                  No presets yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {presets.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setWorkoutsPresetId(String(p.id));
                        setEditingPreset(null);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid',
                        borderColor: workoutsPresetId === String(p.id) ? '#2563eb' : '#e5e7eb',
                        borderRadius: 10,
                        padding: '10px 14px',
                        minHeight: 44,
                        background: workoutsPresetId === String(p.id) ? '#eff6ff' : 'white',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: workoutsPresetId === String(p.id) ? 600 : 400,
                        color: workoutsPresetId === String(p.id) ? '#1d4ed8' : '#111827',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div>{p.name}</div>
                      {p.intensity_label && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          {p.intensity_label}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* New preset form */}
              <details style={{ marginTop: 4 }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#2563eb',
                    fontWeight: 600,
                    padding: '6px 0',
                    listStyle: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  + New preset
                </summary>
                <form
                  onSubmit={handleCreatePreset}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}
                >
                  <div>
                    <label style={{ fontSize: 13 }}>Name</label>
                    <input
                      value={newPreset.name}
                      onChange={e => setNewPreset(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Push Day"
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13 }}>Intensity (optional)</label>
                    <input
                      value={newPreset.intensity_label}
                      onChange={e => setNewPreset(p => ({ ...p, intensity_label: e.target.value }))}
                      placeholder="e.g. Heavy"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13 }}>Notes (optional)</label>
                    <input
                      value={newPreset.notes}
                      onChange={e => setNewPreset(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-secondary"
                    style={{ minHeight: 44 }}
                    disabled={!newPreset.name.trim()}
                  >
                    Create
                  </button>
                </form>
              </details>
            </div>
          </Reveal>

          {/* Preset detail */}
          <Reveal style={{ flex: '1 1 280px', minWidth: 280 }}>
            {!workoutsSelectedPreset ? (
              <div className="card">
                <p className="empty-state" style={{ padding: '24px 0' }}>
                  Select a preset to view and edit its exercises.
                </p>
              </div>
            ) : (
              <div className="card">
                {/* Preset header */}
                {editingPreset ? (
                  <form
                    onSubmit={handleUpdatePreset}
                    style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}
                  >
                    <div>
                      <label style={{ fontSize: 13 }}>Name</label>
                      <input
                        value={editingPreset.name}
                        onChange={e => setEditingPreset(p => ({ ...p, name: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 13 }}>Intensity (optional)</label>
                      <input
                        value={editingPreset.intensity_label || ''}
                        onChange={e => setEditingPreset(p => ({ ...p, intensity_label: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 13 }}>Notes (optional)</label>
                      <input
                        value={editingPreset.notes || ''}
                        onChange={e => setEditingPreset(p => ({ ...p, notes: e.target.value }))}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" className="btn-primary" style={{ minHeight: 40 }}>
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ minHeight: 40 }}
                        onClick={() => setEditingPreset(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 12,
                      marginBottom: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <h3 style={{ margin: '0 0 2px' }}>{workoutsSelectedPreset.name}</h3>
                      {workoutsSelectedPreset.intensity_label && (
                        <span style={{ fontSize: 13, color: '#6b7280' }}>
                          {workoutsSelectedPreset.intensity_label}
                        </span>
                      )}
                      {workoutsSelectedPreset.notes && (
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
                          {workoutsSelectedPreset.notes}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: 13, padding: '7px 14px', minHeight: 36 }}
                        onClick={() => setEditingPreset({ ...workoutsSelectedPreset })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        style={{ fontSize: 13, padding: '7px 14px', minHeight: 36 }}
                        onClick={() => void handleDeletePreset(workoutsSelectedPreset)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0 0 16px' }} />

                {/* Exercise list */}
                <h4 style={{ margin: '0 0 10px', fontSize: 14, color: '#374151' }}>Exercises</h4>
                {workoutsExercises.length === 0 ? (
                  <p className="empty-state" style={{ padding: '12px 0', fontSize: 13 }}>
                    No exercises yet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      marginBottom: 16,
                    }}
                  >
                    {workoutsExercises.map((ex, idx) => (
                      <div
                        key={ex.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          background: '#f9fafb',
                          borderRadius: 8,
                          minHeight: 44,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--color-text-faint)',
                              fontWeight: 600,
                              minWidth: 18,
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span style={{ fontSize: 14 }}>{ex.name}</span>
                        </div>
                        <button
                          type="button"
                          className="btn-danger-ghost"
                          style={{ fontSize: 12, padding: '5px 10px', minHeight: 32 }}
                          onClick={() => void handleRemoveExercise(ex)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add exercise */}
                <form
                  onSubmit={handleAddExercise}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <ExerciseCombobox
                    library={library}
                    value={newExerciseName}
                    onChange={setNewExerciseName}
                    placeholder="Add exercise. Search or type any name…"
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      className="btn-secondary"
                      style={{ minHeight: 44, padding: '0 20px' }}
                      disabled={!newExerciseName.trim()}
                    >
                      Add
                    </button>
                  </div>
                </form>
              </div>
            )}
          </Reveal>
        </div>
      )}

      {/* ── PROGRESS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'progress' && (
        <div>
          <Reveal className="card" style={{ marginBottom: 16 }} delay={120}>
            <h3 className="section-title" style={{ marginBottom: 12 }}>Exercise progress</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 240px' }}>
                <ExerciseCombobox
                  library={library}
                  value={progressInput}
                  onChange={v => {
                    setProgressInput(v);
                    setProgressExercise('');
                  }}
                  placeholder="Search or type an exercise…"
                />
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{ minHeight: 44, padding: '0 20px' }}
                disabled={!progressInput.trim()}
                onClick={() => setProgressExercise(progressInput.trim())}
              >
                View
              </button>
            </div>
          </Reveal>

          {progressExercise && (
            <Reveal className="card">
              <h3 style={{ marginTop: 0 }}>{progressExercise}</h3>
              <ProgressChart exercise={progressExercise} />
            </Reveal>
          )}
        </div>
      )}
    </div>
  );
}
