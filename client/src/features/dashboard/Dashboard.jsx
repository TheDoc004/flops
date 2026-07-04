import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import MacroTotals from '@shared/ui/MacroTotals';
import Reveal from '@shared/ui/Reveal';
import DailyTrainingContextBanner from './DailyTrainingContextBanner';
import TrainingFuelCard from './TrainingFuelCard';
import { fetchLogRange, createLogEntry, createQuickFoodLog, createCustomLog, deleteLogEntry } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchProfile } from '@shared/api/profile';
import { sumMacros, groupByDate } from '@shared/utils/macros';
import { getIsoWeekday, ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';
import { getLocalDateISO, addDaysLocal, parseLocalDateISO } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive, goalsToTargets, hasAnyTarget, resolveGoalRowForDate } from '@features/adherence';
import DashboardAdherenceSection from './DashboardAdherenceSection';
import DashboardWeightRow from './DashboardWeightRow';
import DashboardWeightTrend from './DashboardWeightTrend';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { fetchDailyTrainingContext, saveDailyTrainingContext, fetchSavedFuelRecipes } from '@shared/api/training';
import { computeMealTrainingReadiness } from './mealTrainingReadiness';

function macrosFromLogEntry(entry) {
  const s = Number(entry.servings) || 1;
  const f = entry.recipe_fiber_g != null ? Number(entry.recipe_fiber_g) : 0;
  return {
    calories: Number(entry.recipe_calories) * s,
    protein_g: Number(entry.recipe_protein_g) * s,
    carbs_g: Number(entry.recipe_carbs_g) * s,
    fat_g: Number(entry.recipe_fat_g) * s,
    fiber_g: f * s,
  };
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning!';
  if (hour >= 12 && hour < 17) return 'Good afternoon!';
  if (hour >= 17 && hour < 21) return 'Good evening!';
  return 'Late night check-in!';
}

export default function Dashboard() {
  const { bodyUnits, macroUnits } = useMacroUnits();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [location.state?.scrollToTop]);
  const [today, setToday] = useState(() => getLocalDateISO());
  const [entries, setEntries] = useState([]);
  const [weekLogEntries, setWeekLogEntries] = useState([]);
  const [profileWeightKg, setProfileWeightKg] = useState(null);
  const [goalsPayload, setGoalsPayload] = useState(null);
  const [targets, setTargets] = useState({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
  const [goalsLabel, setGoalsLabel] = useState('');
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [goalsError, setGoalsError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [logInitialEntry, setLogInitialEntry] = useState(null);
  const [error, setError] = useState('');
  const [dashWeightPrefs, setDashWeightPrefs] = useState({ enabled: true, days: 30 });
  const [weightTrendRefresh, setWeightTrendRefresh] = useState(0);
  const [trainingPrefs, setTrainingPrefs] = useState({ enabled: true, digestion_pref: 'none', training_goal: 'performance' });
  const [dailyContext, setDailyContext] = useState('rest');
  const [contextLoading, setContextLoading] = useState(true);
  const [savedFuelOptions, setSavedFuelOptions] = useState([]);
  const [fuelMealSnapshot, setFuelMealSnapshot] = useState(null);

  const greeting = useMemo(() => getGreeting(), []);

  const adherenceRows = useMemo(() => {
    const start = addDaysLocal(today, -6);
    const grouped = groupByDate(weekLogEntries);
    const dates = listLocalDatesInclusive(start, today);
    const dayList = dates.map(d => {
      const g = grouped.find(x => x.date === d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalsPayload, dayList, { todayIso: today });
  }, [today, weekLogEntries, goalsPayload]);

  const fuelReadiness = useMemo(() => {
    if (!fuelMealSnapshot || !trainingPrefs.enabled) return null;
    return computeMealTrainingReadiness({
      ...fuelMealSnapshot.macros,
      contextType: dailyContext,
      bodyWeightKg: profileWeightKg,
      digestionPref: trainingPrefs.digestion_pref,
    });
  }, [fuelMealSnapshot, dailyContext, profileWeightKg, trainingPrefs.enabled, trainingPrefs.digestion_pref]);

  useEffect(() => {
    function syncToday() {
      setToday(prev => {
        const n = getLocalDateISO();
        return prev === n ? prev : n;
      });
    }
    const id = setInterval(syncToday, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') syncToday();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    setFuelMealSnapshot(null);
  }, [today]);

  const load = useCallback(async () => {
    setGoalsError('');
    setError('');
    const weekStart = addDaysLocal(today, -6);
    const [logResult, goalsResult, profileResult, dailyCtxResult, savedFuelResult] = await Promise.allSettled([
      fetchLogRange(weekStart, today),
        fetchGoals({ date: today }),
      fetchProfile(),
      fetchDailyTrainingContext(today),
      fetchSavedFuelRecipes(),
    ]);

    if (profileResult.status === 'fulfilled') {
      const p = profileResult.value;
      setProfileWeightKg(p.weight_kg == null ? null : Number(p.weight_kg));
      const en = p.dash_weight_chart_enabled;
      const enabled = en !== 0 && en !== false && en !== '0';
      const d = Number(p.dash_weight_days);
      setDashWeightPrefs({
        enabled,
        days: [14, 30, 90].includes(d) ? d : 30,
      });

      setTrainingPrefs({
        enabled: p.dash_training_fuel_enabled !== 0 && p.dash_training_fuel_enabled !== false,
        digestion_pref: p.digestion_pref || 'none',
        training_goal: p.training_goal || 'performance',
      });
    }

    if (dailyCtxResult.status === 'fulfilled') {
      setDailyContext(dailyCtxResult.value?.context_type || 'rest');
      setContextLoading(false);
    } else {
      setDailyContext('rest');
      setContextLoading(false);
    }

    if (logResult.status === 'fulfilled') {
      const all = logResult.value;
      setWeekLogEntries(all);
      setEntries(all.filter(e => e.date === today));
    } else {
      setError(logResult.reason?.message || "Failed to load today's log");
      setWeekLogEntries([]);
      setEntries([]);
    }

    if (savedFuelResult.status === 'fulfilled') {
      setSavedFuelOptions(savedFuelResult.value || []);
    } else {
      setSavedFuelOptions([]);
    }

    if (goalsResult.status === 'fulfilled') {
      const goalsData = goalsResult.value;
      if (goalsData?.goals?.length) {
        setGoalsPayload(goalsData);
        const wd = getIsoWeekday(parseLocalDateISO(today));
        const row = resolveGoalRowForDate(goalsData, today);
        setTargets(goalsToTargets(row));
        setGoalsLabel(ISO_WEEKDAY_LABELS[wd] || '');
        setGoalsLoaded(true);
      } else {
        setGoalsPayload(null);
        setTargets({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
        setGoalsLabel('');
        setGoalsLoaded(false);
      }
    } else {
      setGoalsError(goalsResult.reason?.message || 'Failed to load goals');
      setGoalsPayload(null);
      setTargets({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
      setGoalsLabel('');
      setGoalsLoaded(false);
    }

    setWeightTrendRefresh(k => k + 1);
  }, [today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load updates UI from server
    void load();
  }, [load]);

  async function handleDailyContextChange(next) {
    setDailyContext(next);
    try {
      await saveDailyTrainingContext({ date: today, context_type: next });
    } catch (e) {
      setError(e.message);
    }
  }

  function applyFuelSnapshotFromEntry(entry) {
    setFuelMealSnapshot({
      mealLabel: entry.recipe_name || 'Meal',
      macros: macrosFromLogEntry(entry),
    });
  }

  async function handleLog(data) {
    let entry;
    if (data?.quick_food) {
      entry = await createQuickFoodLog({ date: today, ...data.quick_food, notes: data.notes, time_min: data.time_min });
    } else if (data?.log_custom) {
      entry = await createCustomLog({ date: today, ...data.log_custom, notes: data.notes, time_min: data.time_min });
    } else {
      entry = await createLogEntry({ ...data, date: today });
    }
    applyFuelSnapshotFromEntry(entry);
    await load();
  }

  async function handleDelete(entry) {
    try { await deleteLogEntry(entry.id); load(); }
    catch (e) { setError(e.message); }
  }

  const totals = sumMacros(entries);
  const totalLoggedCal = Math.round(totals.calories);

  // Larger, presence-boosted actions for the two primary dashboard buttons.
  // Scoped to these instances (inline) so the global .btn-* sizing is untouched.
  const dashActionStyle = {
    fontSize: 'clamp(14px, 1vw, 16.5px)',
    padding: 'clamp(11px, 1vw, 15px) clamp(16px, 1.7vw, 26px)',
    minHeight: 'clamp(44px, 3.4vw, 52px)',
  };

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <Reveal style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 'clamp(24px, 2.6vw, 34px)',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 'clamp(38px, 3.4vw, 52px)', fontWeight: 400, color: 'var(--color-primary-ink)',
            fontFamily: "'DM Serif Display', Georgia, serif",
            letterSpacing: '-0.02em', lineHeight: 1.05,
          }}>
            {greeting}
          </h1>
          <p style={{ margin: '10px 0 0', color: 'var(--color-text-muted)', fontSize: 'clamp(15px, 1vw, 17px)' }}>
            {goalsLoaded && !goalsError
              ? (
                <>
                  {goalsLabel}
                  {' · '}
                  <Link to="/goals" style={{ color: 'var(--color-text-muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    {hasAnyTarget(targets) ? 'Edit goals' : 'Set goals'}
                  </Link>
                </>
              )
              : today}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to="/ai-logger" className="btn-ai" style={dashActionStyle}>
            <span className="spark" aria-hidden="true">✨</span> AI Estimate
          </Link>
          <button className="btn-primary" onClick={() => setShowModal(true)} style={dashActionStyle}>
            + Log a Meal
          </button>
        </div>
      </Reveal>

      {error && <p className="error" style={{ marginTop: 0, marginBottom: 16 }}>{error}</p>}
      {goalsError && (
        <p className="error" style={{ marginBottom: 16 }}>
          Could not load goals: {goalsError}
        </p>
      )}

      {/* ── Macro totals ── */}
      <Reveal delay={60}>
        <MacroTotals totals={totals} targets={targets} />
      </Reveal>

      {/* ── Today's meals ── */}
      <Reveal delay={120} style={{ marginTop: 'clamp(28px, 3vw, 40px)', marginBottom: 24 }}>
        {/* Card header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'clamp(14px, 1.4vw, 18px)',
          gap: 8,
        }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: 'clamp(28px, 2.6vw, 34px)', fontWeight: 400, color: 'var(--color-primary-ink)',
              fontFamily: "'DM Serif Display', Georgia, serif",
              letterSpacing: '-0.01em',
            }}>
              Today&apos;s Meals
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'clamp(13px, 1vw, 14.5px)', color: 'var(--color-text-muted)' }}>
              {entries.length === 0
                ? 'Nothing logged yet'
                : `${entries.length} meal${entries.length !== 1 ? 's' : ''} · ${totalLoggedCal.toLocaleString()} kcal`}
            </p>
          </div>
        </div>

        {entries.length === 0
          ? (
            <div style={{
              background: 'var(--color-surface)',
              borderRadius: 14,
              border: '1px dashed #c4b5fd',
              padding: 'clamp(24px, 2.4vw, 32px) 16px',
              textAlign: 'center',
            }}>
              <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 'clamp(14px, 1vw, 15.5px)' }}>No meals logged yet.</p>
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                Log a meal
              </button>
            </div>
          )
          : (
            <div style={{
              background: 'var(--color-surface)',
              borderRadius: 14,
              border: '1px solid #e8e4dc',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              overflow: 'hidden',
            }}>
              {entries.map((entry, idx) => (
                <Reveal
                  key={entry.id}
                  delay={Math.min(idx, 6) * 60}
                  style={{ borderBottom: idx < entries.length - 1 ? '1px solid #f0ede8' : 'none' }}
                >
                  <LogEntryRow entry={entry} onDelete={handleDelete} variant="dashboard" />
                </Reveal>
              ))}
            </div>
          )
        }
      </Reveal>

      {/* ── Training context ── */}
      {trainingPrefs.enabled && (
        <Reveal>
          <DailyTrainingContextBanner
            contextType={dailyContext}
            disabled={contextLoading}
            onChange={handleDailyContextChange}
          />
        </Reveal>
      )}

      {/* Training Fuel Timing Assistant — smarter, ingredient-aware successor to
          the old fuel-readiness card. Shows whenever there's a meal logged today. */}
      {trainingPrefs.enabled && entries.length > 0 && (
        <Reveal>
          <TrainingFuelCard entries={entries} />
        </Reveal>
      )}

      {trainingPrefs.enabled && savedFuelOptions.length > 0 && (
        <Reveal className="card" style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', fontSize: 'clamp(13px, 1vw, 14.5px)', color: 'var(--color-text-muted)' }}>Quick log — saved fuel</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {savedFuelOptions.slice(0, 6).map(o => (
              <button
                key={o.recipe_id}
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setLogInitialEntry({ recipe_id: o.recipe_id, servings: 1 });
                  setShowModal(true);
                }}
              >
                {o.label || o.name}
              </button>
            ))}
            <Link to="/training" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--color-text-faint)' }}>
              Edit →
            </Link>
          </div>
        </Reveal>
      )}

      {/* ── Trends ── */}
      {dashWeightPrefs.enabled ? (
        <>
          <Reveal style={{ marginTop: trainingPrefs.enabled ? 20 : 16 }}>
            <h2 style={{
              margin: '0 0 14px', fontSize: 'clamp(28px, 2.6vw, 34px)', fontWeight: 400, color: 'var(--color-primary-ink)',
              fontFamily: "'DM Serif Display', Georgia, serif",
              letterSpacing: '-0.01em',
            }}>Trends</h2>
          </Reveal>

          {/* Combined weight card: trend chart + update form */}
          <Reveal delay={60} className="card" style={{ marginBottom: 16, padding: '20px' }}>
            <DashboardWeightTrend
              noCard
              today={today}
              bodyUnits={bodyUnits}
              rangeDays={dashWeightPrefs.days}
              enabled={dashWeightPrefs.enabled}
              refreshKey={weightTrendRefresh}
            />
            <div style={{ borderTop: '1px solid #f0ede8', margin: '20px 0 16px' }} />
            <DashboardWeightRow
              noCard
              today={today}
              bodyUnits={bodyUnits}
              onWeightSaved={() => setWeightTrendRefresh(k => k + 1)}
            />
          </Reveal>
        </>
      ) : (
        <Reveal>
          <DashboardWeightRow
            today={today}
            bodyUnits={bodyUnits}
            onWeightSaved={() => setWeightTrendRefresh(k => k + 1)}
          />
        </Reveal>
      )}

      {/* ── Goal adherence (flexible range) ── */}
      <Reveal style={{ marginTop: 4 }}>
        <DashboardAdherenceSection
          today={today}
          goalsPayload={goalsPayload}
          macroUnits={macroUnits}
          rows7d={adherenceRows}
        />
      </Reveal>

      {showModal && (
        <LogMealModal
          initialEntry={logInitialEntry || undefined}
          onLog={handleLog}
          onClose={() => {
            setShowModal(false);
            setLogInitialEntry(null);
          }}
        />
      )}
    </div>
  );
}
