import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { fetchProfile, saveProfile, fetchBodyWeights, saveBodyWeight } from '@shared/api/profile';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import {
  cmToFeetInches,
  feetInchesToCm,
  kgToWeightInputValue,
  parseWeightInputToKg,
  kgToLb,
} from '@shared/utils/bodyUnits';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import ChartReveal from '@shared/ui/ChartReveal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import Reveal from '@shared/ui/Reveal';

const ACTIVITY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active' },
  { value: 'very_active', label: 'Very active' },
];

export default function Profile() {
  const { macroUnits, setMacroUnits, bodyUnits, setBodyUnits } = useMacroUnits();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [form, setForm] = useState({});
  const [weights, setWeights] = useState([]);
  const [weightDate, setWeightDate] = useState(() => getLocalDateISO());
  const [weightInput, setWeightInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [weightError, setWeightError] = useState('');
  const [dashChartEnabled, setDashChartEnabled] = useState(true);
  const [dashChartDays, setDashChartDays] = useState(30);
  const [dashAdherenceView, setDashAdherenceView] = useState('7d');
  const [dashSupplementsEnabled, setDashSupplementsEnabled] = useState(true);
  const [dashPrefsSaved, setDashPrefsSaved] = useState(false);
  const [dashPrefsError, setDashPrefsError] = useState('');
  // Tracks whether the user has interacted with dash prefs yet.
  // Prevents auto-save from firing during the initial data load.
  const dashInteracted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, w] = await Promise.all([fetchProfile(), fetchBodyWeights()]);
        if (cancelled) return;
        setForm({
          height_cm: p.height_cm ?? '',
          weight_kg: p.weight_kg ?? '',
          age: p.age ?? '',
          sex: p.sex ?? '',
          goal_weight_kg: p.goal_weight_kg ?? '',
          activity_level: p.activity_level ?? '',
          maintenance_calories: p.maintenance_calories ?? '',
        });
        setWeights(w);
        setDashChartEnabled(p.dash_weight_chart_enabled !== 0 && p.dash_weight_chart_enabled !== false);
        const dd = Number(p.dash_weight_days);
        setDashChartDays([14, 30, 90].includes(dd) ? dd : 30);
        setDashAdherenceView(['7d', '2w', '3w', 'calendar'].includes(p.dash_adherence_view) ? p.dash_adherence_view : '7d');
        setDashSupplementsEnabled(p.dash_supplements_enabled !== 0 && p.dash_supplements_enabled !== false);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = key => e => {
    setForm(f => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  function setHeightFeet(feetStr) {
    setForm(f => {
      const prev = cmToFeetInches(f.height_cm === '' || f.height_cm == null ? null : Number(f.height_cm));
      const cm = feetInchesToCm(feetStr, prev.inches);
      return { ...f, height_cm: cm === null ? '' : cm };
    });
    setSaved(false);
  }

  function setHeightInches(inchesStr) {
    setForm(f => {
      const prev = cmToFeetInches(f.height_cm === '' || f.height_cm == null ? null : Number(f.height_cm));
      const cm = feetInchesToCm(prev.feet, inchesStr);
      return { ...f, height_cm: cm === null ? '' : cm };
    });
    setSaved(false);
  }

  function setWeightField(key) {
    return e => {
      const raw = e.target.value;
      setForm(f => {
        if (bodyUnits === 'us') {
          const kg = parseWeightInputToKg(raw, 'us');
          return { ...f, [key]: kg === null ? '' : kg };
        }
        return { ...f, [key]: raw };
      });
      setSaved(false);
    };
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    try {
      const body = {
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
        weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
        age: form.age === '' ? null : Number(form.age),
        sex: form.sex || null,
        goal_weight_kg: form.goal_weight_kg === '' ? null : Number(form.goal_weight_kg),
        activity_level: form.activity_level || null,
        maintenance_calories: form.maintenance_calories === '' ? null : Number(form.maintenance_calories),
        macro_units: macroUnits,
        body_units: bodyUnits,
      };
      const updated = await saveProfile(body);
      setForm({
        height_cm: updated.height_cm ?? '',
        weight_kg: updated.weight_kg ?? '',
        age: updated.age ?? '',
        sex: updated.sex ?? '',
        goal_weight_kg: updated.goal_weight_kg ?? '',
        activity_level: updated.activity_level ?? '',
        maintenance_calories: updated.maintenance_calories ?? '',
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveWeight(e) {
    e.preventDefault();
    setWeightError('');
    const kg = parseWeightInputToKg(weightInput, bodyUnits);
    const unitHint = bodyUnits === 'us' ? 'pounds' : 'kilograms';
    if (kg == null) {
      setWeightError(`Enter a valid weight in ${unitHint}.`);
      return;
    }
    try {
      await saveBodyWeight(weightDate, kg);
      const list = await fetchBodyWeights();
      setWeights(list);
      setWeightInput('');
    } catch (err) {
      setWeightError(err.message);
    }
  }

  // Auto-save dashboard prefs whenever the user changes them.
  // dashInteracted guard prevents a spurious save during initial load.
  useEffect(() => {
    if (!dashInteracted.current) return;
    let cancelled = false;
    setDashPrefsError('');
    setDashPrefsSaved(false);
    saveProfile({
      dash_weight_chart_enabled: dashChartEnabled ? 1 : 0,
      dash_weight_days: dashChartDays,
      dash_adherence_view: dashAdherenceView,
      dash_supplements_enabled: dashSupplementsEnabled ? 1 : 0,
    }).then(() => {
      if (!cancelled) {
        setDashPrefsSaved(true);
        setTimeout(() => { if (!cancelled) setDashPrefsSaved(false); }, 2000);
      }
    }).catch(err => {
      if (!cancelled) setDashPrefsError(err.message);
    });
    return () => { cancelled = true; };
  }, [dashChartEnabled, dashChartDays, dashAdherenceView, dashSupplementsEnabled]);

  if (loading) {
    return <p style={{ color: '#6b7280' }}>Loading…</p>;
  }

  const heightFeetIn = cmToFeetInches(
    form.height_cm === '' || form.height_cm == null ? null : Number(form.height_cm)
  );

  const chartData = weights.map(r => ({
    date: r.date,
    weight_kg: r.weight_kg,
    weightY: bodyUnits === 'us' ? kgToLb(r.weight_kg) : r.weight_kg,
  }));

  const yUnit = bodyUnits === 'us' ? ' lb' : ' kg';
  const weightLabel = bodyUnits === 'us' ? 'Weight (lb)' : 'Weight (kg)';
  const heightLabel = bodyUnits === 'us' ? 'Height' : 'Height (cm)';

  const H3 = ({ children }) => (
    <h3 className="section-title" style={{ marginBottom: 10 }}>{children}</h3>
  );

  const UnitOption = ({ name, value, current, onChange, label, sub }) => (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
      padding: '8px 10px', borderRadius: 9,
      border: `1px solid ${current === value ? '#c4b5fd' : '#e8e4dc'}`,
      background: current === value ? '#f5f3ff' : 'transparent',
      transition: 'border-color 0.12s, background 0.12s',
    }}>
      {/* width:auto overrides the global `input { width: 100% }` rule */}
      <input
        type="radio"
        name={name}
        checked={current === value}
        onChange={() => onChange(value)}
        style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1e1b4b', lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>{sub}</div>
      </div>
    </label>
  );

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ margin: 0 }}>Profile &amp; body weight</h1>
      </Reveal>

      {error && <p className="error">{error}</p>}

      {/* ── Row 1: unit toggles ── */}
      <Reveal delay={60} className="settings-grid">
        <div className="card">
          <H3>Nutrition units</H3>
          <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
            How protein, carbs &amp; fat appear in goals and the Dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <UnitOption name="nutritionUnits" value="metric" current={macroUnits} onChange={setMacroUnits}
              label="Grams" sub="protein, carbs, fat in g" />
            <UnitOption name="nutritionUnits" value="us" current={macroUnits} onChange={setMacroUnits}
              label="Ounces" sub="protein, carbs, fat in oz" />
          </div>
        </div>

        <div className="card">
          <H3>Body measurements</H3>
          <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
            How height and weight appear on this page.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <UnitOption name="bodyUnits" value="metric" current={bodyUnits} onChange={setBodyUnits}
              label="Metric" sub="cm / kg" />
            <UnitOption name="bodyUnits" value="us" current={bodyUnits} onChange={setBodyUnits}
              label="US-style" sub="ft / in / lb" />
          </div>
        </div>
      </Reveal>

      {/* ── Row 2: dashboard prefs + log weight ── */}
      <Reveal delay={120} className="settings-grid">
        <div className="card">
          <H3>Dashboard</H3>
          {/* Checkbox */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
            padding: '8px 10px', marginBottom: 10, borderRadius: 9,
            border: `1px solid ${dashChartEnabled ? '#c4b5fd' : '#e8e4dc'}`,
            background: dashChartEnabled ? '#f5f3ff' : 'transparent',
            transition: 'border-color 0.12s, background 0.12s',
          }}>
            {/* width:auto overrides the global `input { width: 100% }` rule */}
            <input
              type="checkbox"
              checked={dashChartEnabled}
              onChange={e => {
                dashInteracted.current = true;
                setDashChartEnabled(e.target.checked);
              }}
              style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', lineHeight: 1.3 }}>
                Show weight trend chart
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>
                Visible on Dashboard
              </div>
            </div>
          </label>
          {/* Supplements checklist toggle */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
            padding: '8px 10px', marginBottom: 10, borderRadius: 9,
            border: `1px solid ${dashSupplementsEnabled ? '#c4b5fd' : '#e8e4dc'}`,
            background: dashSupplementsEnabled ? '#f5f3ff' : 'transparent',
            transition: 'border-color 0.12s, background 0.12s',
          }}>
            <input
              type="checkbox"
              checked={dashSupplementsEnabled}
              onChange={e => {
                dashInteracted.current = true;
                setDashSupplementsEnabled(e.target.checked);
              }}
              style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', lineHeight: 1.3 }}>
                Show supplements checklist
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>
                Daily check-off card on Dashboard
              </div>
            </div>
          </label>
          {/* Range select */}
          <div>
            <label style={{ marginBottom: 4 }}>Chart range</label>
            <select
              value={dashChartDays}
              onChange={e => {
                dashInteracted.current = true;
                setDashChartDays(Number(e.target.value));
              }}
            >
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          {/* Goal adherence: the dashboard shows exactly one view (no tabs) */}
          <div style={{ marginTop: 10 }}>
            <label style={{ marginBottom: 4 }}>Goal adherence view</label>
            <select
              value={dashAdherenceView}
              onChange={e => {
                dashInteracted.current = true;
                setDashAdherenceView(e.target.value);
              }}
            >
              <option value="7d">Last 7 days</option>
              <option value="2w">Last 2 weeks</option>
              <option value="3w">Last 3 weeks</option>
              <option value="calendar">Month calendar</option>
            </select>
          </div>
          {dashPrefsError && <p className="error" style={{ marginTop: 8 }}>{dashPrefsError}</p>}
          {dashPrefsSaved && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#059669' }}>Saved.</p>
          )}
        </div>

        <div className="card">
          <H3>Log body weight</H3>
          <form onSubmit={handleSaveWeight}>
            <div className="form-grid-2" style={{ marginBottom: 10 }}>
              <div>
                <label>Date</label>
                <input type="date" value={weightDate} max={getLocalDateISO()} onChange={e => setWeightDate(e.target.value)} />
              </div>
              <div>
                <label>{weightLabel}</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={weightInput}
                  onChange={e => setWeightInput(e.target.value)}
                  placeholder={bodyUnits === 'us' ? 'e.g. 160' : 'e.g. 72.5'}
                />
              </div>
            </div>
            <button type="submit" className="btn-primary">Save weight</button>
          </form>
          {weightError && <p className="error" style={{ marginTop: 8 }}>{weightError}</p>}
        </div>
      </Reveal>

      {/* ── Row 3: personal stats (full width) ── */}
      <Reveal>
      <form onSubmit={handleSaveProfile} className="card" style={{ marginBottom: 16 }}>
        <H3>Personal stats</H3>
        <div className="form-grid-2">
          {bodyUnits === 'us' ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <label>{heightLabel}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ width: 80 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>ft</span>
                  <input
                    type="number" min="0" max="8" step="1" inputMode="numeric"
                    value={heightFeetIn.feet}
                    onChange={e => setHeightFeet(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div style={{ width: 88 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>in</span>
                  <input
                    type="number" min="0" max="12" step="0.1" inputMode="decimal"
                    value={heightFeetIn.inches}
                    onChange={e => setHeightInches(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label>{heightLabel}</label>
              <input type="number" min="0" step="0.1" value={form.height_cm} onChange={set('height_cm')} placeholder="Optional" />
            </div>
          )}

          <div>
            <label>{bodyUnits === 'us' ? 'Current weight (lb)' : 'Current weight (kg)'}</label>
            <input type="number" min="0" step="0.1"
              value={kgToWeightInputValue(form.weight_kg, bodyUnits)}
              onChange={setWeightField('weight_kg')} placeholder="Optional" />
          </div>
          <div>
            <label>Age</label>
            <input type="number" min="0" max="130" step="1" value={form.age} onChange={set('age')} placeholder="Optional" />
          </div>
          <div>
            <label>Sex</label>
            <select value={form.sex} onChange={set('sex')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label>{bodyUnits === 'us' ? 'Goal weight (lb)' : 'Goal weight (kg)'}</label>
            <input type="number" min="0" step="0.1"
              value={kgToWeightInputValue(form.goal_weight_kg, bodyUnits)}
              onChange={setWeightField('goal_weight_kg')} placeholder="Optional" />
          </div>
          <div>
            <label>Activity level</label>
            <select value={form.activity_level} onChange={set('activity_level')}>
              {ACTIVITY_OPTIONS.map(o => (
                <option key={o.value || 'empty'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Estimated maintenance calories</label>
            <input type="number" min="0" step="1" value={form.maintenance_calories} onChange={set('maintenance_calories')} placeholder="Optional" />
          </div>
        </div>
        {saved && <p style={{ color: '#059669', fontSize: 14, marginTop: 12 }}>Profile saved.</p>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn-primary">Save profile</button>
        </div>
      </form>
      </Reveal>

      {/* ── Row 4: weight trend chart (full width) ── */}
      <Reveal className="card">
        <H3>Weight trend</H3>
        {chartData.length === 0 ? (
          <p className="empty-state" style={{ padding: 24 }}>No weight entries yet.</p>
        ) : (
          <ChartReveal height={260}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} unit={yUnit} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)}${yUnit.trim()}`, 'Weight']}
                />
                <Line
                  type="monotone" dataKey="weightY"
                  stroke="#312e81" strokeWidth={2} dot
                  name={bodyUnits === 'us' ? 'Weight (lb)' : 'Weight (kg)'}
                  isAnimationActive={!reduceMotion}
                  animationDuration={900}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartReveal>
        )}
      </Reveal>
    </div>
  );
}
