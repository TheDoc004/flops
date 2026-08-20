import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addTemplateExercise,
  createGymTemplate,
  deleteGymTemplate,
  deleteTemplateExercise,
  fetchGymExercises,
  fetchGymTemplates,
  fetchTemplateExercises,
  updateGymTemplate,
  updateTemplateExercise,
} from '@shared/api/gym';
import Reveal from '@shared/ui/Reveal';
import ExerciseSearch from '../components/ExerciseSearch';
import styles from '../Gym.module.css';

const MUSCLE_ORDER = [
  'chest', 'shoulders', 'triceps', 'back', 'biceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio', 'other',
];

function muscleLabel(m) {
  return m ? m.replace(/^\w/, c => c.toUpperCase()) : 'Other';
}

export default function GymWorkouts() {
  const [templates, setTemplates] = useState([]);
  const [library, setLibrary] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', split_label: '', notes: '', progression_notes: '' });
  const [creating, setCreating] = useState('');

  const load = useCallback(async () => {
    const [t, ex] = await Promise.all([fetchGymTemplates(), fetchGymExercises()]);
    setTemplates(t);
    setLibrary(ex);
    const fallback = t[0] || null;
    setSelectedId(id => (id && t.some(x => x.id === id) ? id : fallback?.id ?? null));
    if (fallback) {
      setDraft(d => (d.name ? d : {
        name: fallback.name || '',
        split_label: fallback.split_label || '',
        notes: fallback.notes || '',
        progression_notes: fallback.progression_notes || '',
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch templates
    void load().catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [load]);

  const selected = templates.find(t => t.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    fetchTemplateExercises(selectedId)
      .then(rows => { if (!cancelled) setItems(rows); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = it.primary_muscle || 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return MUSCLE_ORDER.filter(k => map.has(k)).map(k => [k, map.get(k)]);
  }, [items]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!creating.trim()) return;
    const t = await createGymTemplate({ name: creating.trim() });
    setCreating('');
    await load();
    setSelectedId(t.id);
  }

  async function saveMeta(e) {
    e.preventDefault();
    if (!selected) return;
    await updateGymTemplate(selected.id, draft);
    await load();
  }

  async function addEx(ex) {
    if (!selected) return;
    await addTemplateExercise(selected.id, ex.id ? { exercise_id: ex.id, rest_sec: 90 } : { name: ex.name, rest_sec: 90 });
    setItems(await fetchTemplateExercises(selected.id));
  }

  async function patchItem(item, patch) {
    await updateTemplateExercise(selected.id, item.id, { ...item, ...patch });
    setItems(await fetchTemplateExercises(selected.id));
  }

  return (
    <div>
      <Reveal className={styles.toolbar}>
        <div>
          <h2 className="section-title">Workouts</h2>
          <p className={styles.lede}>Templates with set, rep, and weight targets. Organize by muscle.</p>
        </div>
      </Reveal>
      {error && <p className="error">{error}</p>}
      <div className={styles.split}>
        <div className="card" style={{ margin: 0 }}>
          <h3 className="section-title" style={{ marginBottom: 12 }}>My workouts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                className={styles.listBtn}
                data-on={selectedId === t.id ? '1' : '0'}
                onClick={() => {
                  setSelectedId(t.id);
                  setDraft({
                    name: t.name || '',
                    split_label: t.split_label || '',
                    notes: t.notes || '',
                    progression_notes: t.progression_notes || '',
                  });
                }}
              >
                <div>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 2 }}>
                  {t.split_label || 'Custom'} · {t.exercise_count || 0} exercises
                </div>
              </button>
            ))}
          </div>
          <form onSubmit={e => void handleCreate(e)} style={{ display: 'flex', gap: 8 }}>
            <input value={creating} onChange={e => setCreating(e.target.value)} placeholder="New workout" />
            <button type="submit" className="btn-secondary" disabled={!creating.trim()}>Add</button>
          </form>
        </div>

        {!selected ? (
          <div className="card"><p className="empty-state">Create a workout to add exercises.</p></div>
        ) : (
          <div className="card" style={{ margin: 0 }}>
            <form onSubmit={e => void saveMeta(e)} style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              <div>
                <label>Name</label>
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} required />
              </div>
              <div>
                <label>Split</label>
                <input value={draft.split_label} onChange={e => setDraft(d => ({ ...d, split_label: e.target.value }))} placeholder="Push / Pull / Legs, Upper, Full body" />
              </div>
              <div>
                <label>Notes</label>
                <input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Warmup, frequency, intensity" />
              </div>
              <div>
                <label>Progression</label>
                <input value={draft.progression_notes} onChange={e => setDraft(d => ({ ...d, progression_notes: e.target.value }))} placeholder="Add 5 lb when every set hits the target" />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn-primary">Save</button>
                <button
                  type="button"
                  className="btn-danger-ghost"
                  onClick={() => {
                    if (!window.confirm(`Delete ${selected.name}?`)) return;
                    void deleteGymTemplate(selected.id).then(load).catch(e => setError(e.message));
                  }}
                >
                  Delete
                </button>
              </div>
            </form>

            <h3 className="section-title" style={{ marginBottom: 8 }}>Exercises</h3>
            <ExerciseSearch library={library} onPick={ex => void addEx(ex).catch(e => setError(e.message))} />

            {grouped.map(([muscle, rows]) => (
              <div key={muscle}>
                <div className={styles.muscleHead}>{muscleLabel(muscle)}</div>
                {rows.map(it => (
                  <div key={it.id} className={styles.exRow}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{it.name}</div>
                      <div className={styles.targets} style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12 }}>Sets
                          <input type="number" min="0" value={it.target_sets ?? ''} onChange={e => void patchItem(it, { target_sets: e.target.value })} />
                        </label>
                        <label style={{ fontSize: 12 }}>Reps
                          <input type="number" min="0" value={it.target_reps ?? ''} onChange={e => void patchItem(it, { target_reps: e.target.value })} />
                        </label>
                        <label style={{ fontSize: 12 }}>Weight
                          <input type="number" min="0" step="0.5" value={it.target_weight ?? ''} onChange={e => void patchItem(it, { target_weight: e.target.value })} />
                        </label>
                        <label style={{ fontSize: 12 }}>Rest s
                          <input type="number" min="0" value={it.rest_sec ?? ''} onChange={e => void patchItem(it, { rest_sec: e.target.value })} />
                        </label>
                      </div>
                    </div>
                    <button type="button" className="btn-danger-ghost" onClick={() => void deleteTemplateExercise(selected.id, it.id).then(() => fetchTemplateExercises(selected.id).then(setItems))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
