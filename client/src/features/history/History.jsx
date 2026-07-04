import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import { fetchLogRange, fetchLogForDate, createLogEntry, createQuickFoodLog, createCustomLog, deleteLogEntry, updateLogEntry } from '@shared/api/log';
import { sumMacros } from '@shared/utils/macros';
import { getLocalDateISO, addDaysLocal } from '@shared/utils/dateLocal';
import { getWeekdayLongNameFromIsoDate } from '@shared/utils/weekday';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import Reveal from '@shared/ui/Reveal';
import { AdherenceCalendarMonth, AdherenceExplorer } from '@features/adherence';
import { sumDayMicros } from '@shared/utils/microNutrients';
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

/** True only for a real calendar date in strict YYYY-MM-DD form. */
function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export default function History() {
  const { macroUnits } = useMacroUnits();
  const location = useLocation();

  // The dashboard's adherence card links to /history#goal-adherence. Content
  // above the target streams in after mount (calendar/report data), so a
  // single scroll lands short — nudge it a few times until layout settles.
  useEffect(() => {
    if (location.hash !== '#goal-adherence') return undefined;
    const scroll = () =>
      document.getElementById('goal-adherence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const timers = [0, 300, 800].map(ms => setTimeout(scroll, ms));
    return () => timers.forEach(clearTimeout);
  }, [location.hash]);

  // ── Selection + report state ──
  // Unified selection: clicking days toggles them; presets pick a range.
  // presetN (7|14|30|null) only drives the summary label ("Last N days").
  const [selDates, setSelDates] = useState(() => [getLocalDateISO()]);
  const [presetN, setPresetN] = useState(null);
  const [reportDays, setReportDays] = useState([]);
  const [reportDates, setReportDates] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const reportRef = useRef(null);
  const editRef = useRef(null);

  // ── Logged Day editor state (edit/add/delete — preserved) ──
  const [selectedDate, setSelectedDate] = useState('');
  const [dayEntries, setDayEntries] = useState([]);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [dateInput, setDateInput] = useState('');     // raw manual "jump to date" text
  const [dateInputError, setDateInputError] = useState('');

  const selectedTotals = useMemo(() => sumMacros(dayEntries), [dayEntries]);

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
      const entries = await fetchLogRange(list[0], list[list.length - 1]);
      const byDate = {};
      for (const e of entries) (byDate[e.date] ||= []).push(e);
      const days = list.map(date => {
        const es = byDate[date] || [];
        return { date, entries: es, totals: sumMacros(es), micros: sumDayMicros(es) };
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
  function applyPreset(n) {
    setPresetN(n);
    setSelDates(presetDates(n));
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  // Clear → back to today, so the page never feels blank.
  function clearSelection() {
    setPresetN(null);
    setSelDates([getLocalDateISO()]);
  }

  // ── Day editor handlers (preserved) ──
  async function selectDate(date) {
    setSelectedDate(date);
    setDateInput(date || '');
    setDateInputError('');
    if (!date) {
      setDayEntries([]);
      return;
    }
    try { setDayEntries(await fetchLogForDate(date)); }
    catch (e) { setError(e.message); }
  }

  // Manual "jump to a specific date" — accepts YYYY-MM-DD, validates friendly.
  function handleDateJump() {
    const v = dateInput.trim();
    if (!isValidIsoDate(v)) {
      setDateInputError('Enter a date as YYYY-MM-DD (e.g. 2026-06-23).');
      return;
    }
    void selectDate(v);
  }

  async function reloadSelectedDay() {
    if (!selectedDate) return;
    try { setDayEntries(await fetchLogForDate(selectedDate)); }
    catch (e) { setError(e.message); }
  }

  // Refresh the report too if the edited day is part of it.
  async function refreshAfterEdit() {
    await reloadSelectedDay();
    if (reportDates.length) await buildReport(reportDates);
  }

  async function handleAddMeal(data) {
    if (!selectedDate) return;
    if (data?.quick_food) {
      await createQuickFoodLog({ date: selectedDate, ...data.quick_food, notes: data.notes, time_min: data.time_min });
    } else if (data?.log_custom) {
      await createCustomLog({ date: selectedDate, ...data.log_custom, notes: data.notes, time_min: data.time_min });
    } else {
      await createLogEntry({ ...data, date: selectedDate });
    }
    setShowAddModal(false);
    await refreshAfterEdit();
  }

  async function handleEditMeal(data) {
    if (!editEntry) return;
    await updateLogEntry(editEntry.id, data);
    setEditEntry(null);
    await refreshAfterEdit();
  }

  async function handleDeleteMeal(entry) {
    await deleteLogEntry(entry.id);
    await refreshAfterEdit();
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

      {/* ── Selection card ── */}
      <Reveal delay={60} className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>Review nutrition</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9ca3af' }}>
          Pick one or more days, or use a preset range. The report below updates automatically.
        </p>

        {/* Preset ranges */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {[7, 14, 30].map(n => (
            <button
              key={n}
              type="button"
              className={presetN === n ? 'btn-primary' : 'btn-secondary'}
              style={{ minHeight: 0, padding: '7px 14px', fontSize: 13 }}
              onClick={() => applyPreset(n)}
            >
              {n}D
            </button>
          ))}
        </div>

        {/* Calendar with selection */}
        <AdherenceCalendarMonth
          macroUnits={macroUnits}
          bare
          selectedDates={selDates}
          onDayClick={onCalendarDayClick}
        />

        {/* Selection summary + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
            {selectionLabel}{reportLoading ? ' · updating…' : ''}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              title="Jump to the day editor below"
            >
              Edit a day ↓
            </button>
            <button type="button" className="btn-secondary" onClick={clearSelection}>Clear</button>
          </div>
        </div>

        {/* ── Goal adherence — same card as the calendar above, one tool ── */}
        <div id="goal-adherence" style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-divider-warm)', scrollMarginTop: 90 }}>
          <AdherenceExplorer noCard />
        </div>
      </Reveal>

      {/* ── Report ── */}
      <Reveal>
        <div ref={reportRef}>
          <NutritionReport days={reportDays} loading={reportLoading} error={reportError} />
        </div>
      </Reveal>


      {/* ── Logged Day Explorer (edit/add/delete) ── */}
      <Reveal>
      <div ref={editRef} className="card" style={{ scrollMarginTop: 120 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>Edit a logged day</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>
          Pick a day to add, edit, correct, or delete its meals. This is separate from the report selection above.
        </p>

        {/* Single-day calendar picker for editing (independent of the report selection) */}
        <AdherenceCalendarMonth
          macroUnits={macroUnits}
          bare
          dayMinHeight={76}
          selectedDates={selectedDate ? [selectedDate] : []}
          onDayClick={(d) => void selectDate(d)}
        />

        {/* Manual date entry — plain text field, no browser calendar picker. */}
        <div style={{ marginTop: 20 }}>
          <label htmlFor="edit-date-jump" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#374151' }}>
            Jump to a specific date
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              id="edit-date-jump"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="YYYY-MM-DD"
              value={dateInput}
              onChange={(e) => { setDateInput(e.target.value); if (dateInputError) setDateInputError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDateJump(); } }}
              style={{ flex: '1 1 240px', maxWidth: 340, fontSize: 16, padding: '12px 14px' }}
            />
            <button type="button" className="btn-primary" onClick={handleDateJump}>Go</button>
          </div>
          {dateInputError && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#b91c1c' }}>{dateInputError}</p>
          )}
        </div>

        {!selectedDate && (
          <div style={{ padding: '24px 0 8px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280', fontWeight: 500 }}>No day selected.</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>
              Pick a day from the calendar above, or type a date and press Go.
            </p>
          </div>
        )}

        {selectedDate && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 220px', padding: '12px 14px', border: '1px solid #e8e4dc', borderRadius: 10, background: '#faf9f7' }}>
                <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                  <strong style={{ color: '#1e1b4b' }}>{getWeekdayLongNameFromIsoDate(selectedDate)}</strong>{' · '}{selectedDate}
                </p>
                <p style={{ margin: '5px 0 0', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <strong>{Math.round(selectedTotals.calories).toLocaleString('en-US')}</strong> cal
                  {' · '}P {selectedTotals.protein_g.toFixed(1)}g
                  {' · '}C {selectedTotals.carbs_g.toFixed(1)}g
                  {' · '}F {selectedTotals.fat_g.toFixed(1)}g
                </p>
              </div>
              <button type="button" className="btn-primary" onClick={() => setShowAddModal(true)}>
                + Add meal
              </button>
            </div>

            <div>
              {dayEntries.length === 0
                ? <p className="empty-state">No meals logged on {selectedDate}.</p>
                : dayEntries.map((entry, idx) => (
                  <Reveal key={entry.id} delay={Math.min(idx, 6) * 60}>
                    <LogEntryRow entry={entry} onEdit={() => setEditEntry(entry)} onDelete={handleDeleteMeal} />
                  </Reveal>
                ))}
            </div>
          </div>
        )}
      </div>
      </Reveal>

      {showAddModal && (
        <LogMealModal title={`Add meal — ${selectedDate}`} submitLabel="Add Meal" onLog={handleAddMeal} onClose={() => setShowAddModal(false)} />
      )}
      {editEntry && (
        <LogMealModal title={`Edit meal — ${editEntry.date}`} submitLabel="Save Changes" initialEntry={editEntry} onLog={handleEditMeal} onClose={() => setEditEntry(null)} />
      )}
    </div>
  );
}
