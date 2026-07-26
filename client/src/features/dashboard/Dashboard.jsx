import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import { AiLoggerModal } from '@features/ai-macro-logger';
import MacroTotals from '@shared/ui/MacroTotals';
import Reveal from '@shared/ui/Reveal';
import { fetchLogRange, createLogEntry, deleteLogEntry } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchProfile } from '@shared/api/profile';
import { sumMacros, groupByDate } from '@shared/utils/macros';
import { getIsoWeekday, ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';
import { getLocalDateISO, addDaysLocal, parseLocalDateISO } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive, goalsToTargets, hasAnyTarget, resolveGoalRowForDate } from '@features/adherence';
import DashboardAdherenceSection from './DashboardAdherenceSection';
import DashboardWeightRow from './DashboardWeightRow';
import DashboardWeightTrend from './DashboardWeightTrend';
import { SupplementsCard } from '@features/supplements';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';

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
  const [goalsPayload, setGoalsPayload] = useState(null);
  const [targets, setTargets] = useState({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
  const [goalsLabel, setGoalsLabel] = useState('');
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [goalsError, setGoalsError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [error, setError] = useState('');
  const [dashWeightPrefs, setDashWeightPrefs] = useState({ enabled: true, days: 30 });
  const [dashAdherenceView, setDashAdherenceView] = useState('7d');
  const [weightTrendRefresh, setWeightTrendRefresh] = useState(0);
  const [dashSupplementsEnabled, setDashSupplementsEnabled] = useState(true);
  const [supplementMacros, setSupplementMacros] = useState({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

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

  const load = useCallback(async () => {
    setGoalsError('');
    setError('');
    const weekStart = addDaysLocal(today, -6);
    const [logResult, goalsResult, profileResult] = await Promise.allSettled([
      fetchLogRange(weekStart, today),
        fetchGoals({ date: today }),
      fetchProfile(),
    ]);

    if (profileResult.status === 'fulfilled') {
      const p = profileResult.value;
      const en = p.dash_weight_chart_enabled;
      const enabled = en !== 0 && en !== false && en !== '0';
      const d = Number(p.dash_weight_days);
      setDashWeightPrefs({
        enabled,
        days: [14, 30, 90].includes(d) ? d : 30,
      });
      setDashAdherenceView(['7d', '2w', '3w', 'calendar'].includes(p.dash_adherence_view) ? p.dash_adherence_view : '7d');
      const se = p.dash_supplements_enabled;
      setDashSupplementsEnabled(se !== 0 && se !== false && se !== '0');
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

  async function handleLog(data) {
    await createLogEntry({ ...data, date: today });
    await load();
  }

  async function handleDelete(entry) {
    try { await deleteLogEntry(entry.id); load(); }
    catch (e) { setError(e.message); }
  }

  const totals = sumMacros(entries);
  const totalLoggedCal = Math.round(totals.calories);
  // Fold in macros from supplements taken today that are flagged to count.
  const combinedTotals = dashSupplementsEnabled
    ? {
        calories: totals.calories + supplementMacros.calories,
        protein_g: totals.protein_g + supplementMacros.protein_g,
        carbs_g: totals.carbs_g + supplementMacros.carbs_g,
        fat_g: totals.fat_g + supplementMacros.fat_g,
      }
    : totals;

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
          <button type="button" className="btn-ai" onClick={() => setShowAiModal(true)} style={dashActionStyle}>
            <span className="spark" aria-hidden="true">✨</span> AI Estimate
          </button>
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

      {/* ── Macro totals (meals + any macro-counting supplements taken today) ── */}
      <Reveal delay={60}>
        <MacroTotals totals={combinedTotals} targets={targets} />
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

      {/* ── Supplements today ── */}
      {dashSupplementsEnabled && (
        <SupplementsCard date={today} onMacrosChange={setSupplementMacros} />
      )}

      {/* Quick hop to the micronutrient breakdown (supplements feed into it). */}
      {dashSupplementsEnabled && (
        <Reveal delay={40} style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <Link
            to="/history#micronutrients"
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 16px', textDecoration: 'none' }}
          >
            View micronutrients →
          </Link>
        </Reveal>
      )}

      {/* ── Trends ── */}
      {dashWeightPrefs.enabled ? (
        <>
          <Reveal style={{ marginTop: 16 }}>
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
          view={dashAdherenceView}
        />
      </Reveal>

      {showModal && (
        <LogMealModal
          onLog={handleLog}
          onOpenAi={() => { setShowModal(false); setShowAiModal(true); }}
          onClose={() => setShowModal(false)}
        />
      )}

      {showAiModal && (
        <AiLoggerModal
          initialDate={today}
          onLogged={load}
          onClose={() => setShowAiModal(false)}
        />
      )}
    </div>
  );
}
