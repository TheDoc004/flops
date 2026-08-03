import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogMealModal } from '@features/meal-logging';
import { fetchLogRange, createLogEntry, deleteLogEntry, updateLogEntry } from '@shared/api/log';
import { sumMacros, sumSupplementMacros, addMacroTotals } from '@shared/utils/macros';
import { getLocalDateISO, addDaysLocal } from '@shared/utils/dateLocal';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import WeightTrendChart from './WeightTrendChart';
import Reveal from '@shared/ui/Reveal';
import { AdherenceCalendarMonth, DashboardAdherencePicker } from '@features/adherence';
import { sumDayTotalMicros } from '@shared/utils/microNutrients';
import { fetchSupplementRange } from '@shared/api/supplements';
import NutritionReport from './NutritionReport';

/** Inclusive list of ISO dates from start..end (capped for safety). */
function enumerateDates(start, end) {
  if (!start || !end) return [];
  const [a, b] = start <= end ? [start, end] : [end, start];
  const out = [];
  let cur = a;
  for (let i = 0; i < 400; i++) {
    out.push(cur);
    if (cur === b) break;
    cur = addDaysLocal(cur, 1);
  }
  return out;
}

function presetDates(n) {
  const today = getLocalDateISO();
  return enumerateDates(addDaysLocal(today, -(n - 1)), today);
}

export default function History() {
  const { macroUnits, bodyUnits } = useMacroUnits();
  const location = useLocation();

  // The dashboard's adherence card links to /history#goal-adherence. Content
  // above the target streams in after mount (calendar/report data), so a
  // single scroll lands short — nudge it a few times until layout settles.
  useEffect(() => {
    const id = location.hash.slice(1); // e.g. #goal-adherence, #micronutrients
    if (!id) return undefined;
    const scroll = () =>
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Long tail: content above the target streams in (calendar month data, the
    // report), so the layout can still be growing well past the first second.
    const timers = [0, 250, 600, 1100, 1800].map(ms => setTimeout(scroll, ms));
    return () => timers.forEach(clearTimeout);
  }, [location.hash]);

  // ── Selection + report state ──
  // Unified selection: clicking days toggles them; presets pick a range.
  // presetN (7|14|30|null) only drives the summary label ("Last N days").
  const [selDates, setSelDates] = useState(() => [getLocalDateISO()]);
  const [presetN, setPresetN] = useState(null);
  /**
   * Month the calendar should show (YYYY-MM). Presets point it at where the
   * range STARTS — "last 30 days" begins in the previous month, so leaving the
   * grid on the current month showed only the tail of the selection.
   */
  const [focusMonth, setFocusMonth] = useState(null);
  const [reportDays, setReportDays] = useState([]);
  const [reportDates, setReportDates] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const reportRef = useRef(null);

  // ── Meal editing, driven from the report itself ──
  // A day is fixed where it's being read, so there's no separate selected-day
  // state: the date comes from whichever report row the action came from.
  const [error, setError] = useState('');
  const [addForDate, setAddForDate] = useState(null);
  const [editEntry, setEditEntry] = useState(null);

  // ── Build the report for a set of dates ──
  const buildReport = useCallback(async (dates) => {
    const list = Array.from(new Set(dates || [])).sort();
    if (list.length === 0) {
      setReportDays([]);
      setReportDates([]);
      return;
    }
    setReportLoading(true);
    setReportError('');
    try {
      const start = list[0];
      const end = list[list.length - 1];
      // Meal entries drive macros + micros; taken supplements add exact micros
      // plus the macros of any flagged to count — the same math Today does.
      // The supplement fetch is best-effort so meals still render if it fails.
      const [entries, suppRange] = await Promise.all([
        fetchLogRange(start, end),
        fetchSupplementRange(start, end).catch(() => ({ byDate: {} })),
      ]);
      const suppByDate = suppRange?.byDate || {};
      const byDate = {};
      for (const e of entries) (byDate[e.date] ||= []).push(e);
      const days = list.map(date => {
        const es = byDate[date] || [];
        const supps = suppByDate[date] || [];
        const suppTotals = sumSupplementMacros(supps);
        return {
          date,
          entries: es,
          totals: addMacroTotals(sumMacros(es), suppTotals),
          supplementTotals: suppTotals,
          micros: sumDayTotalMicros({ entries: es, supplements: supps }),
        };
      });
      setReportDays(days);
      setReportDates(list);
    } catch (e) {
      setReportError(e.message || 'Failed to build report');
    } finally {
      setReportLoading(false);
    }
  }, []);

  // Toggle a day in/out of the selection. Any manual edit drops the preset label.
  function onCalendarDayClick(date) {
    setPresetN(null);
    setSelDates(prev => (prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]));
  }

  // Preset range: replace the selection with the last N days and label it as such.
  // Presets toggle: pressing the active one again drops back to today, so a
  // range can be flicked on and off without hand-picking days to undo it.
  function applyPreset(n) {
    if (presetN === n) {
      clearSelection();
      return;
    }
    setPresetN(n);
    const dates = presetDates(n);
    setSelDates(dates);
    setFocusMonth(dates[0].slice(0, 7));
    // Deliberately no auto-scroll: yanking the page down to the report on every
    // preset press fought whatever you were doing in the calendar.
  }

  // Clear → back to today, so the page never feels blank.
  function clearSelection() {
    setPresetN(null);
    setSelDates([getLocalDateISO()]);
    setFocusMonth(getLocalDateISO().slice(0, 7));
  }

  // ── Meal edit handlers ──
  // Rebuilding the report is the whole refresh: it re-fetches the range and
  // recomputes totals, meals and micros for every day on screen.
  async function refreshAfterEdit() {
    if (reportDates.length) await buildReport(reportDates);
  }

  async function handleAddMeal(data) {
    if (!addForDate) return;
    try {
      await createLogEntry({ ...data, date: addForDate });
      setAddForDate(null);
      await refreshAfterEdit();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleEditMeal(data) {
    if (!editEntry) return;
    try {
      await updateLogEntry(editEntry.id, data);
      setEditEntry(null);
      await refreshAfterEdit();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteMeal(entry) {
    try {
      await deleteLogEntry(entry.id);
      await refreshAfterEdit();
    } catch (e) {
      setError(e.message);
    }
  }

  // Report auto-updates from the current selection (no "View Breakdown" step).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- report tracks selection
    void buildReport(selDates);
  }, [selDates, buildReport]);

  const selectionLabel = useMemo(() => {
    if (selDates.length === 0) return 'No days selected.';
    if (presetN) return `Last ${presetN} days`;
    if (selDates.length === 1) return `1 day · ${selDates[0]}`;
    return `${selDates.length} selected days`;
  }, [selDates, presetN]);

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ marginBottom: 20 }}>History & Trends</h1>
      </Reveal>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      {/* ── Calendar & adherence card (anchor target for the dashboard's
            "Open full adherence in History →" button) ── */}
      <Reveal delay={60} id="goal-adherence" className="card" style={{ marginBottom: 20, scrollMarginTop: 90 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>Calendar & adherence</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-faint)' }}>
          Days are colored by adherence.
        </p>

        {/* Preset ranges — each toggles, so pressing the lit one clears it. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {[7, 14, 30].map(n => {
            const active = presetN === n;
            return (
              <button
                key={n}
                type="button"
                className={active ? 'btn-primary' : 'btn-secondary'}
                style={{ minHeight: 0, padding: '7px 14px', fontSize: 13 }}
                onClick={() => applyPreset(n)}
                aria-pressed={active}
                title={active ? `Showing the last ${n} days — press again to clear` : `Show the last ${n} days`}
              >
                {n}D
              </button>
            );
          })}
        </div>

        {/* Calendar: click selects days for the report below, hover (or long
            press) shows that day's numbers. The card header above owns the
            title/hint, so the calendar's own header is hidden. */}
        <AdherenceCalendarMonth
          macroUnits={macroUnits}
          bare
          hideHeader
          selectedDates={selDates}
          onDayClick={onCalendarDayClick}
          focusMonth={focusMonth}
        />

        {/* Selection summary + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
            {selectionLabel}{reportLoading ? ' · updating…' : ''}
          </p>
          {/* No "Edit a day" jump any more — meals are edited in the report
              itself, directly below. */}
          <button type="button" className="btn-secondary" onClick={clearSelection}>Clear</button>
        </div>

        {/* ── Dashboard pin — which adherence view the dashboard card shows ── */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-divider-warm)' }}>
          <DashboardAdherencePicker />
        </div>
      </Reveal>

      {/* ── Report (micronutrient panel lives inside — anchor for #micronutrients) ── */}
      <Reveal>
        <div ref={reportRef} id="micronutrients" style={{ scrollMarginTop: 90 }}>
          <NutritionReport
            days={reportDays}
            loading={reportLoading}
            error={reportError}
            onAddMeal={setAddForDate}
            onEditMeal={setEditEntry}
            onDeleteMeal={handleDeleteMeal}
          />
        </div>
      </Reveal>


      {/* ── Weight trend ──
          Moved here from the Today tab: Today is for logging your weight, this
          is for seeing where it's going. Carries its own range (30D/90D/All) —
          weight moves on a different timescale to meals, so tying it to the day
          selection above made the default a single dot.
          Today's weigh-in card links straight here (/history#weight-trend). */}
      <Reveal id="weight-trend" style={{ scrollMarginTop: 90 }}>
        <WeightTrendChart bodyUnits={bodyUnits} />
      </Reveal>

      {addForDate && (
        <LogMealModal title={`Add meal — ${addForDate}`} submitLabel="Add Meal" onLog={handleAddMeal} onClose={() => setAddForDate(null)} />
      )}
      {editEntry && (
        <LogMealModal title={`Edit meal — ${editEntry.date}`} submitLabel="Save Changes" initialEntry={editEntry} onLog={handleEditMeal} onClose={() => setEditEntry(null)} />
      )}
    </div>
  );
}
