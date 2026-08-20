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
import { fetchGymExercises, fetchGymOneRm, fetchGymProgress, saveGymOneRm } from '@shared/api/gym';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import Reveal from '@shared/ui/Reveal';
import ChartReveal from '@shared/ui/ChartReveal';
import ExerciseSearch from '../components/ExerciseSearch';
import { estimateOneRm, ONE_RM_FORMULAS, percentChart, xrmWeight } from '../lib/oneRm';
import { platePlan } from '../lib/plates';
import styles from '../Gym.module.css';

const WINDOWS = [
  { id: 'W', label: 'W' },
  { id: '2W', label: '2W' },
  { id: 'M', label: 'M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: 'ALL', label: 'All' },
];

export default function GymProgress() {
  const { bodyUnits } = useMacroUnits();
  const unit = bodyUnits === 'us' ? 'lb' : 'kg';
  const [library, setLibrary] = useState([]);
  const [exercise, setExercise] = useState(null);
  const [windowId, setWindowId] = useState('ALL');
  const [lastN, setLastN] = useState('');
  const [repMin, setRepMin] = useState('');
  const [repMax, setRepMax] = useState('');
  const [data, setData] = useState({ daily: [], sets: [] });
  const [orm, setOrm] = useState(null);
  const [formula, setFormula] = useState('epley');
  const [estReps, setEstReps] = useState('5');
  const [estWeight, setEstWeight] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchGymExercises().then(setLibrary).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!exercise) return;
    fetchGymProgress({
      exercise_id: exercise.id,
      window: windowId,
      last_sessions: lastN || undefined,
      rep_min: repMin || undefined,
      rep_max: repMax || undefined,
    }).then(setData).catch(e => setError(e.message));
    fetchGymOneRm(exercise.id).then(setOrm).catch(() => {});
  }, [exercise, windowId, lastN, repMin, repMax]);

  const lastSet = data.sets[data.sets.length - 1];
  const estimated = useMemo(() => {
    const w = estWeight || lastSet?.weight;
    const r = estReps || lastSet?.reps;
    return estimateOneRm(w, r, formula);
  }, [estWeight, estReps, lastSet, formula]);

  const oneRm = orm?.tested || orm?.estimated || estimated;
  const pct = percentChart(oneRm);
  const plates = platePlan(oneRm, { unit });

  async function persistEstimate() {
    if (!exercise || estimated == null) return;
    setOrm(await saveGymOneRm(exercise.id, { estimated, formula }));
  }

  return (
    <div>
      <Reveal className={styles.toolbar}>
        <div>
          <h2 className="section-title">Progress</h2>
          <p className={styles.lede}>Weight, reps, and volume over time. Filter by window or rep range.</p>
        </div>
      </Reveal>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <ExerciseSearch library={library} onPick={setExercise} placeholder="Choose an exercise" />
        {exercise && <p style={{ margin: '10px 0 0', fontWeight: 600 }}>{exercise.name}</p>}
        <div className={styles.chips} style={{ marginTop: 12 }}>
          {WINDOWS.map(w => (
            <button key={w.id} type="button" className={styles.chip} data-on={windowId === w.id ? '1' : '0'} onClick={() => setWindowId(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
        <div className={styles.targets} style={{ marginTop: 12 }}>
          <label>Last N sessions
            <input value={lastN} onChange={e => setLastN(e.target.value)} placeholder="All" />
          </label>
          <label>Rep min
            <input value={repMin} onChange={e => setRepMin(e.target.value)} />
          </label>
          <label>Rep max
            <input value={repMax} onChange={e => setRepMax(e.target.value)} />
          </label>
        </div>
      </div>

      {exercise && (
        <div className="card">
          {data.daily.length === 0 ? (
            <p className="empty-state">No sets in this window.</p>
          ) : (
            <ChartReveal height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="w" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line yAxisId="w" type="monotone" dataKey="top_weight" name={`Weight (${unit})`} stroke="var(--color-primary)" dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="reps" name="Reps" stroke="var(--color-text-muted)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartReveal>
          )}
          {lastSet && (
            <p className={styles.prev} style={{ marginTop: 8 }}>
              Last set {lastSet.date}: {lastSet.reps} × {lastSet.weight} {lastSet.weight_unit || unit}
            </p>
          )}
        </div>
      )}

      {exercise && (
        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 12 }}>1RM</h3>
          <div className={styles.targets}>
            <label>Formula
              <select value={formula} onChange={e => setFormula(e.target.value)}>
                {ONE_RM_FORMULAS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label>Reps
              <input type="number" min="1" value={estReps} onChange={e => setEstReps(e.target.value)} />
            </label>
            <label>Weight ({unit})
              <input type="number" min="0" step="0.5" value={estWeight} onChange={e => setEstWeight(e.target.value)} placeholder={lastSet?.weight ?? ''} />
            </label>
          </div>
          <p style={{ margin: '12px 0', fontSize: 18, fontWeight: 600 }}>
            {estimated != null ? `${estimated} ${unit}` : 'Enter a set'}
            {orm?.tested ? ` · tested ${orm.tested}` : ''}
          </p>
          <button type="button" className="btn-secondary" onClick={() => void persistEstimate()} disabled={estimated == null}>
            Save estimate
          </button>

          {pct.length > 0 && (
            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                <thead>
                  <tr><th style={{ textAlign: 'left' }}>% 1RM</th><th>Reps</th><th>Load</th></tr>
                </thead>
                <tbody>
                  {pct.map(row => (
                    <tr key={row.pct}><td>{row.pct}%</td><td>{row.reps}</td><td>{row.weight} {unit}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.prev} style={{ marginTop: 10 }}>
                3RM {xrmWeight(oneRm, 3)} · 5RM {xrmWeight(oneRm, 5)} · 8RM {xrmWeight(oneRm, 8)} {unit}
              </p>
            </div>
          )}
        </div>
      )}

      {exercise && plates && (
        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 8 }}>Plates</h3>
          <p className={styles.lede}>
            For {oneRm} {unit}: {plates.bar} {unit} bar, {plates.perSide} {unit} each side.
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {plates.plates.map(p => (
              <li key={p.weight}>{p.count} × {p.weight} {unit}</li>
            ))}
          </ul>
          {plates.leftover > 0 && (
            <p className={styles.prev}>Remainder {plates.leftover} {unit} (no matching plate).</p>
          )}
        </div>
      )}
    </div>
  );
}
