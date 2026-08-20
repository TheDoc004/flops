import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import { AiLoggerModal } from '@features/ai-macro-logger';
import MacroTotals from '@shared/ui/MacroTotals';
import Reveal from '@shared/ui/Reveal';
import { fetchLogRange, createLogEntry, createCustomLog, deleteLogEntry } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchProfile } from '@shared/api/profile';
import { sumMacros } from '@shared/utils/macros';
import { getIsoWeekday, ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';
import { getLocalDateISO, parseLocalDateISO, loadViewingDate, saveViewingDate, shouldOfferNewDay, dismissNewDayOffer, goToCalendarToday, addDaysLocal, formatMealsSectionTitle, formatDisplayDate } from '@shared/utils/dateLocal';
import { goalsToTargets, hasAnyTarget, resolveGoalRowForDate } from '@features/adherence';
import DashboardWeightRow from './DashboardWeightRow';
import PrepStrip from './PrepStrip';
import { SupplementStrip } from '@features/supplements';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';

const MEAL_CLIPBOARD_KEY = 'flops_meal_clipboard';

/** Snapshot fields needed to recreate a log entry via createLogEntry / createCustomLog. */
function mealClipboardSnapshot(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    recipe_id: entry.recipe_id ?? null,
    recipe_is_quick_food: entry.recipe_is_quick_food ?? null,
    recipe_name: entry.recipe_name ?? null,
    recipe_calories: entry.recipe_calories ?? null,
    recipe_protein_g: entry.recipe_protein_g ?? null,
    recipe_carbs_g: entry.recipe_carbs_g ?? null,
    recipe_fat_g: entry.recipe_fat_g ?? null,
    recipe_fiber_g: entry.recipe_fiber_g ?? null,
    servings: entry.servings ?? null,
    notes: entry.notes ?? null,
    time_min: entry.time_min ?? null,
    ingredients_json: entry.ingredients_json ?? null,
    slot_selections_json: entry.slot_selections_json ?? null,
  };
}

function loadMealClipboard() {
  try {
    const raw = sessionStorage.getItem(MEAL_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return mealClipboardSnapshot(parsed);
  } catch {
    return null;
  }
}

function persistMealClipboard(snapshot) {
  try {
    if (snapshot) sessionStorage.setItem(MEAL_CLIPBOARD_KEY, JSON.stringify(snapshot));
    else sessionStorage.removeItem(MEAL_CLIPBOARD_KEY);
  } catch { /* storage unavailable */ }
}

/** Vault Prep/Plan on Today until ready — flip to true to remount PrepStrip. */
const SHOW_PREP_PLAN = false;

/** Vault future-day planning until ready — past days stay so missed meals can be logged. */
const ALLOW_FUTURE_DAYS = false;

function clampViewingDate(viewing, cal = getLocalDateISO()) {
  if (!ALLOW_FUTURE_DAYS && viewing > cal) return cal;
  return viewing;
}

/** Dwell on a viewing date before slide-down so ←/→ scrubbing doesn't spam the banner. */
const BANNER_DWELL_MS = 5000;

/** Parse ingredients_json into POST /api/log(…/custom) ingredient rows. Never throws. */
function ingredientsPayloadFromEntry(entry) {
  const raw = entry?.ingredients_json;
  if (!raw) return null;
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
  if (!Array.isArray(v) || !v.length) return null;
  const rows = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const row = { name };
    if (r.amount != null && r.amount !== '') row.amount = r.amount;
    if (typeof r.unit === 'string') row.unit = r.unit;
    if (r.calories != null) row.calories = r.calories;
    if (r.protein_g != null) row.protein_g = r.protein_g;
    if (r.carbs_g != null) row.carbs_g = r.carbs_g;
    if (r.fat_g != null) row.fat_g = r.fat_g;
    if (r.fiber_g != null) row.fiber_g = r.fiber_g;
    if (r.source) row.source = r.source;
    if (r.label_ingredient_id != null) row.label_ingredient_id = r.label_ingredient_id;
    rows.push(row);
  }
  return rows.length ? rows : null;
}

/** Parse slot_selections_json for POST /api/log when no receipt rows exist. */
function slotSelectionsFromEntry(entry) {
  const raw = entry?.slot_selections_json;
  if (!raw) return null;
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning!';
  if (hour >= 12 && hour < 17) return 'Good afternoon!';
  if (hour >= 17 && hour < 21) return 'Good evening!';
  return 'Late night check-in!';
}

/** Initial dismiss: respect day-hold stay for past dates; future always offers. */
function initialBannerDismissed(viewing, cal) {
  if (viewing === cal) return true;
  if (viewing < cal) return !shouldOfferNewDay(viewing, cal);
  return false;
}

export default function Dashboard() {
  const { bodyUnits } = useMacroUnits();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [location.state?.scrollToTop]);
  const [today, setToday] = useState(() => clampViewingDate(loadViewingDate()));
  const [calendarToday, setCalendarToday] = useState(() => getLocalDateISO());
  const [bannerDismissed, setBannerDismissed] = useState(() =>
    initialBannerDismissed(clampViewingDate(loadViewingDate()), getLocalDateISO()),
  );
  const [bannerOpen, setBannerOpen] = useState(false);
  const bannerDelayRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [targets, setTargets] = useState({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
  const [goalsLabel, setGoalsLabel] = useState('');
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [goalsError, setGoalsError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const copyStatusTimerRef = useRef(null);
  const [mealClipboard, setMealClipboard] = useState(() => loadMealClipboard());
  const pasteLockRef = useRef(false);
  const pasteDoneTimerRef = useRef(null);
  const [pasteUi, setPasteUi] = useState('idle'); // idle | pasting | done
  const [dashSupplementsEnabled, setDashSupplementsEnabled] = useState(true);
  const [supplementMacros, setSupplementMacros] = useState({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

  const greeting = useMemo(() => getGreeting(), []);
  const isFutureDay = today > calendarToday;
  const isPastDay = today < calendarToday;
  const isOffToday = today !== calendarToday;
  const canGoForward = ALLOW_FUTURE_DAYS || today < calendarToday;
  const bannerDesired = isOffToday && !bannerDismissed;
  const dayShiftDir = useRef('fwd');
  const skipDayAnim = useRef(true);

  function shiftDay(delta) {
    const next = addDaysLocal(today, delta);
    const cal = getLocalDateISO();
    if (!ALLOW_FUTURE_DAYS && next > cal) return;
    skipDayAnim.current = false;
    dayShiftDir.current = delta < 0 ? 'back' : 'fwd';
    setToday(next);
    // Arrow navigation always re-offers the off-today banner (fixes past-day miss).
    setBannerDismissed(next === cal);
  }

  // Delayed reveal: cancel while scrubbing dates, then slide open.
  useEffect(() => {
    if (bannerDelayRef.current != null) {
      clearTimeout(bannerDelayRef.current);
      bannerDelayRef.current = null;
    }
    if (!bannerDesired) {
      setBannerOpen(false);
      return undefined;
    }
    setBannerOpen(false);
    bannerDelayRef.current = setTimeout(() => {
      setBannerOpen(true);
      bannerDelayRef.current = null;
    }, BANNER_DWELL_MS);
    return () => {
      if (bannerDelayRef.current != null) {
        clearTimeout(bannerDelayRef.current);
        bannerDelayRef.current = null;
      }
    };
  }, [bannerDesired, today]);

  // Notebook day-hold: watch the calendar clock, but never auto-flip the viewing date.
  useEffect(() => {
    function syncCalendar() {
      const n = getLocalDateISO();
      setCalendarToday(n);
      if (!ALLOW_FUTURE_DAYS && today > n) {
        setToday(n);
        setBannerDismissed(true);
        return;
      }
      if (today === n) {
        setBannerDismissed(true);
      } else if (today < n) {
        // Overnight roll: respect stay dismiss for day-hold.
        setBannerDismissed(!shouldOfferNewDay(today, n));
      }
      // Future day while calendar ticks: leave session dismiss alone.
    }
    const id = setInterval(syncCalendar, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') syncCalendar();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [today]);

  function handleGoToToday() {
    skipDayAnim.current = false;
    dayShiftDir.current = today < calendarToday ? 'fwd' : 'back';
    const n = goToCalendarToday(getLocalDateISO());
    setCalendarToday(n);
    setToday(n);
    setBannerDismissed(true);
    setBannerOpen(false);
  }

  function handleStayOnDay() {
    if (today < calendarToday) dismissNewDayOffer(today, calendarToday);
    setBannerDismissed(true);
    setBannerOpen(false);
  }

  useEffect(() => {
    saveViewingDate(today);
  }, [today]);

  useEffect(() => {
    setPasteUi('idle');
    pasteLockRef.current = false;
    if (pasteDoneTimerRef.current != null) {
      clearTimeout(pasteDoneTimerRef.current);
      pasteDoneTimerRef.current = null;
    }
  }, [today]);

  // Invert the whole chrome while this page is looking at a non-today date.
  // Cleared on unmount so Recipes/Review stay the living beige theme.
  useEffect(() => {
    const root = document.documentElement;
    if (isPastDay) root.setAttribute('data-notebook-day', 'past');
    else if (isFutureDay) root.setAttribute('data-notebook-day', 'future');
    else root.removeAttribute('data-notebook-day');
    return () => root.removeAttribute('data-notebook-day');
  }, [isPastDay, isFutureDay]);

  const load = useCallback(async () => {
    setGoalsError('');
    setError('');
    // Only today's entries — the week-long fetch existed for the adherence
    // section, which now lives in Review.
    const [logResult, goalsResult, profileResult] = await Promise.allSettled([
      fetchLogRange(today, today),
        fetchGoals({ date: today }),
      fetchProfile(),
    ]);

    if (profileResult.status === 'fulfilled') {
      const p = profileResult.value;
      // dash_weight_chart_enabled / dash_weight_days are retained-unused: the
      // weight trend chart moved to History, where its range follows the days
      // selected there.
      const se = p.dash_supplements_enabled;
      setDashSupplementsEnabled(se !== 0 && se !== false && se !== '0');
    }

    if (logResult.status === 'fulfilled') {
      const all = logResult.value;
      setEntries(all.filter(e => e.date === today));
    } else {
      setError(logResult.reason?.message || "Failed to load today's log");
      setEntries([]);
    }

    if (goalsResult.status === 'fulfilled') {
      const goalsData = goalsResult.value;
      if (goalsData?.goals?.length) {
        const wd = getIsoWeekday(parseLocalDateISO(today));
        const row = resolveGoalRowForDate(goalsData, today);
        setTargets(goalsToTargets(row));
        setGoalsLabel(ISO_WEEKDAY_LABELS[wd] || '');
        setGoalsLoaded(true);
      } else {
        setTargets({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
        setGoalsLabel('');
        setGoalsLoaded(false);
      }
    } else {
      setGoalsError(goalsResult.reason?.message || 'Failed to load goals');
      setTargets({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
      setGoalsLabel('');
      setGoalsLoaded(false);
    }

  }, [today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load updates UI from server
    void load();
  }, [load]);

  async function handleLog(data) {
    // A bare ingredient logs as a one-off food, not a recipe log.
    if (data?.custom) await createCustomLog({ ...data.custom, date: today });
    else await createLogEntry({ ...data, date: today });
    await load();
  }

  async function handleDelete(entry) {
    try { await deleteLogEntry(entry.id); load(); }
    catch (e) { setError(e.message); }
  }

  function flashCopyStatus(msg) {
    if (copyStatusTimerRef.current != null) {
      clearTimeout(copyStatusTimerRef.current);
      copyStatusTimerRef.current = null;
    }
    setCopyStatus(msg);
    copyStatusTimerRef.current = setTimeout(() => {
      setCopyStatus('');
      copyStatusTimerRef.current = null;
    }, 2800);
  }

  useEffect(() => () => {
    if (copyStatusTimerRef.current != null) clearTimeout(copyStatusTimerRef.current);
    if (pasteDoneTimerRef.current != null) clearTimeout(pasteDoneTimerRef.current);
  }, []);

  /** Stash a meal snapshot for paste onto any viewing day. */
  function handleCopyMeal(entry) {
    const snapshot = mealClipboardSnapshot(entry);
    if (!snapshot) return;
    setMealClipboard(snapshot);
    persistMealClipboard(snapshot);
    flashCopyStatus('Meal copied');
  }

  /** Paste the clipboard meal onto the viewing day. Locked until the row lands. */
  async function handlePasteMeal() {
    if (pasteLockRef.current) return;
    const entry = mealClipboard;
    if (!entry) return;
    pasteLockRef.current = true;
    setPasteUi('pasting');
    setError('');
    const ingredients = ingredientsPayloadFromEntry(entry);
    const slotSelections = slotSelectionsFromEntry(entry);
    const isQuick = !!Number(entry.recipe_is_quick_food);

    try {
      let pasted = false;
      if (entry.recipe_id && !isQuick) {
        try {
          await createLogEntry({
            recipe_id: entry.recipe_id,
            date: today,
            servings: entry.servings,
            ...(entry.notes != null && String(entry.notes).trim() ? { notes: String(entry.notes).trim() } : {}),
            ...(entry.time_min != null ? { time_min: entry.time_min } : {}),
            ...(ingredients?.length ? { ingredients } : {}),
            ...(!ingredients?.length && slotSelections ? { slot_selections: slotSelections } : {}),
          });
          pasted = true;
        } catch {
          // Recipe gone / archived / receipt rejected — denormalized custom log.
        }
      }
      if (!pasted) {
        await createCustomLog({
          date: today,
          name: (entry.recipe_name && String(entry.recipe_name).trim()) || 'Meal',
          calories: Number(entry.recipe_calories) || 0,
          protein_g: Number(entry.recipe_protein_g) || 0,
          carbs_g: Number(entry.recipe_carbs_g) || 0,
          fat_g: Number(entry.recipe_fat_g) || 0,
          ...(entry.recipe_fiber_g != null && entry.recipe_fiber_g !== ''
            && Number.isFinite(Number(entry.recipe_fiber_g))
            ? { fiber_g: Number(entry.recipe_fiber_g) }
            : {}),
          servings: Number(entry.servings) > 0 ? Number(entry.servings) : 1,
          ...(entry.notes != null && String(entry.notes).trim() ? { notes: String(entry.notes).trim() } : {}),
          ...(entry.time_min != null ? { time_min: entry.time_min } : {}),
          ...(ingredients?.length ? { ingredients } : {}),
        });
      }
      await load();
      setPasteUi('done');
      if (pasteDoneTimerRef.current != null) clearTimeout(pasteDoneTimerRef.current);
      pasteDoneTimerRef.current = setTimeout(() => {
        setPasteUi('idle');
        pasteLockRef.current = false;
        pasteDoneTimerRef.current = null;
      }, 1400);
    } catch (e) {
      setError(e.message || 'Failed to paste meal');
      setPasteUi('idle');
      pasteLockRef.current = false;
    }
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

  // The two primary dashboard buttons. With no "Log" tab in the nav, these ARE
  // the way into logging, so they're sized to be the first thing you reach for
  // rather than header trim. Scoped inline so the global .btn-* sizing is
  // untouched.
  const dashActionStyle = {
    fontSize: '15px',
    fontWeight: 600,
    padding: '10px 18px',
    minHeight: '44px',
  };

  const dayBodyAnim = skipDayAnim.current
    ? ''
    : ` dashboard-day-body--${dayShiftDir.current}`;

  return (
    <div className="dashboard">
      {/* ── Day ← / → row stays fixed in Y; banner animates below and may push the greeting ── */}
      <Reveal className="dash-toolbar">
        <div className="dash-day">
          <button
            type="button"
            className="day-nav-btn"
            aria-label="Previous day"
            onClick={() => shiftDay(-1)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6 9 12l6 6" />
            </svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <p className="dash-day-meta">
              <strong style={{ color: 'var(--color-primary-ink)', fontWeight: 600 }}>{formatDisplayDate(today)}</strong>
              {goalsLoaded && !goalsError
                ? (
                  <>
                    {' · '}
                    {goalsLabel}
                    {' · '}
                    <Link to="/goals" style={{ color: 'var(--color-text-muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                      {hasAnyTarget(targets) ? 'Edit goals' : 'Set goals'}
                    </Link>
                  </>
                )
                : null}
            </p>
          </div>
          <button
            type="button"
            className="day-nav-btn"
            aria-label="Next day"
            disabled={!canGoForward}
            onClick={() => shiftDay(1)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        <div className="dash-actions">
          <button
            type="button"
            className="btn-ai"
            onClick={() => setShowAiModal(true)}
            style={dashActionStyle}
            title="Speak or describe a meal in plain language"
          >
            AI Estimate
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowModal(true)}
            style={dashActionStyle}
            title="Build a receipt from a recipe or ingredients"
          >
            + Log a Meal
          </button>
        </div>
      </Reveal>

      <div
        className={`day-off-banner-slot${bannerOpen ? ' is-open' : ''}`}
        aria-hidden={!bannerOpen}
      >
        <div className="day-off-banner-slot-inner">
          <div
            className={`day-off-banner${isFutureDay ? ' day-off-banner--future' : ''}`}
            role="status"
          >
            <div className="day-off-banner-copy">
              {isFutureDay ? (
                <>
                  <strong>Planning ahead</strong>
                  <span>
                    {formatDisplayDate(today)} is ahead of today. Plan ahead here, or jump back to {formatDisplayDate(calendarToday)}.
                  </span>
                </>
              ) : (
                <>
                  <strong>You’re looking at {formatDisplayDate(today)}</strong>
                  <span>
                    {' '}Go to today ({formatDisplayDate(calendarToday)})?
                  </span>
                </>
              )}
            </div>
            <div className="day-off-banner-actions">
              <button type="button" className="btn-primary" onClick={handleGoToToday} style={{ minHeight: 40, padding: '8px 16px' }}>
                Go to today
              </button>
              <button type="button" className="btn-secondary" onClick={handleStayOnDay} style={{ minHeight: 40, padding: '8px 16px' }}>
                {isFutureDay ? 'Stay & plan' : `Stay on ${formatDisplayDate(today)}`}
              </button>
              <button
                type="button"
                className="modal-close-x"
                aria-label="Dismiss"
                onClick={handleStayOnDay}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div key={today} className={`dashboard-day-body${dayBodyAnim}`}>
      <h1 className="page-title dash-greeting">
        {isFutureDay ? 'Planning ahead' : isPastDay ? 'Looking back' : greeting}
      </h1>

      {error && <p className="error" style={{ marginTop: 0, marginBottom: 16 }}>{error}</p>}
      {copyStatus && (
        <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--color-success)', fontSize: 'var(--text-secondary)' }}>
          {copyStatus}
        </p>
      )}
      {goalsError && (
        <p className="error" style={{ marginBottom: 16 }}>
          Could not load goals: {goalsError}
        </p>
      )}

      {/* ── Macro totals (meals + any macro-counting supplements taken today) ── */}
      <Reveal>
        <MacroTotals totals={combinedTotals} targets={targets} />
      </Reveal>

      {/* Supplements ride right under the macros they feed — a compact strip
          you tick off in place, not a section to scroll to. */}
      {dashSupplementsEnabled && (
        <SupplementStrip date={today} onMacrosChange={setSupplementMacros} />
      )}

      {/* ── Today's weight ──
          High on the page on purpose: weighing in is a daily action, so it sits
          with the other daily actions rather than below the meal list. The
          trend chart lives in History (WeightTrendChart) — Today is for doing,
          Review is for looking. */}
      <Reveal className="dash-section">
        <DashboardWeightRow today={today} bodyUnits={bodyUnits} />
      </Reveal>

      {SHOW_PREP_PLAN && (
        <Reveal>
          <PrepStrip date={today} onLogged={load} />
        </Reveal>
      )}

      {/* ── Meals for the viewing day ── */}
      <Reveal className="dash-section" style={{ marginBottom: 24 }}>
        {/* Card header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'clamp(14px, 1.4vw, 18px)',
          gap: 8,
        }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>
              {formatMealsSectionTitle(today, calendarToday)}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-secondary)', color: 'var(--color-text-muted)' }}>
              {entries.length === 0
                ? 'Nothing logged yet'
                : `${entries.length} meal${entries.length !== 1 ? 's' : ''} · ${totalLoggedCal.toLocaleString()} kcal`}
            </p>
          </div>
          {mealClipboard && (
            <button
              type="button"
              className={`btn-secondary paste-meal-btn${pasteUi === 'pasting' ? ' btn-loading' : ''}${pasteUi === 'done' ? ' is-pasted' : ''}`}
              onClick={() => { void handlePasteMeal(); }}
              disabled={pasteUi !== 'idle'}
              aria-busy={pasteUi === 'pasting'}
              aria-live="polite"
              title="Paste the copied meal onto this day"
            >
              {pasteUi === 'pasting' ? (
                <><span className="btn-spinner" aria-hidden="true" />Pasting…</>
              ) : pasteUi === 'done' ? (
                <>
                  <svg className="paste-meal-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5 9.5 17 19 7" />
                  </svg>
                  Pasted
                </>
              ) : (
                'Paste meal'
              )}
            </button>
          )}
        </div>

        {entries.length === 0
          ? (
            <div style={{
              background: 'var(--color-surface)',
              borderRadius: 14,
              border: '1px dashed var(--color-secondary-border)',
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
              border: '1px solid var(--color-surface-border)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              overflow: 'visible',
            }}>
              {entries.map((entry, idx) => (
                <Reveal
                  key={entry.id}
                  delay={Math.min(idx, 6) * 60}
                  style={{ borderBottom: idx < entries.length - 1 ? '1px solid var(--color-divider-warm)' : 'none' }}
                >
                  <LogEntryRow
                    entry={entry}
                    onDelete={handleDelete}
                    onCopyMeal={handleCopyMeal}
                    variant="dashboard"
                  />
                </Reveal>
              ))}
            </div>
          )
        }
      </Reveal>
      </div>

      {showModal && (
        <LogMealModal
          onLog={handleLog}
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
