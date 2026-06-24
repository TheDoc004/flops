import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import { fetchLogRange, fetchLogForDate, fetchLogDays, createLogEntry, createQuickFoodLog, createCustomLog, deleteLogEntry, updateLogEntry } from '@shared/api/log';
import { sumMacros } from '@shared/utils/macros';
import { getLocalDateISO, addDaysLocal } from '@shared/utils/dateLocal';
import { getWeekdayLongNameFromIsoDate } from '@shared/utils/weekday';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { AdherenceCalendarMonth } from '@features/adherence';
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

const MODES = [
  { key: 'single', label: 'Single' },
  { key: 'multi', label: 'Multi' },
  { key: 'range', label: 'Range' },
];

export default function History() {
  const { macroUnits } = useMacroUnits();

  // ── Selection + report state ──
  const [mode, setMode] = useState('single');
  const [selDates, setSelDates] = useState(() => [getLocalDateISO()]);
  const [rangeAnchor, setRangeAnchor] = useState(null);
  const [reportDays, setReportDays] = useState([]);
  const [reportDates, setReportDates] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const reportRef = useRef(null);

  // ── Logged Day Explorer state (edit/add/delete — preserved) ──
  const [selectedDate, setSelectedDate] = useState('');
  const [dayEntries, setDayEntries] = useState([]);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [dayRows, setDayRows] = useState([]);
  const [daysLoading, setDaysLoading] = useState(false);
  const [daysHasMore, setDaysHasMore] = useState(true);
  const [daysOffset, setDaysOffset] = useState(0);
  const [showDayList, setShowDayList] = useState(true);
  const [visibleDayCount, setVisibleDayCount] = useState(14);

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

  function viewBreakdown() {
    void buildReport(selDates);
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function changeMode(next) {
    setMode(next);
    setRangeAnchor(null);
    setSelDates(next === 'single' ? [getLocalDateISO()] : []);
  }

  function onCalendarDayClick(date) {
    if (mode === 'single') {
      setSelDates([date]);
    } else if (mode === 'multi') {
      setSelDates(prev => (prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]));
    } else {
      // range
      if (!rangeAnchor) {
        setRangeAnchor(date);
        setSelDates([date]);
      } else {
        setSelDates(enumerateDates(rangeAnchor, date));
        setRangeAnchor(null);
      }
    }
  }

  function applyPreset(n) {
    const dates = presetDates(n);
    setMode('range');
    setRangeAnchor(null);
    setSelDates(dates);
    void buildReport(dates);
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function clearSelection() {
    setSelDates([]);
    setRangeAnchor(null);
    setReportDays([]);
    setReportDates([]);
  }

  // ── Explorer handlers (preserved) ──
  async function selectDate(date) {
    setSelectedDate(date);
    setVisibleDayCount(14);
    if (!date) {
      setDayEntries([]);
      setShowDayList(true);
      return;
    }
    setShowDayList(false);
    try { setDayEntries(await fetchLogForDate(date)); }
    catch (e) { setError(e.message); }
  }

  async function handleDateChange(e) {
    await selectDate(e.target.value);
  }

  async function reloadSelectedDay() {
    if (!selectedDate) return;
    try { setDayEntries(await fetchLogForDate(selectedDate)); }
    catch (e) { setError(e.message); }
  }

  const reloadDayList = useCallback(async () => {
    setDaysLoading(true);
    setError('');
    try {
      const first = await fetchLogDays({ limit: 60, offset: 0 });
      setDayRows(first);
      setDaysOffset(first.length);
      setDaysHasMore(first.length === 60);
    } catch (e) {
      setError(e.message);
      setDayRows([]);
      setDaysOffset(0);
      setDaysHasMore(false);
    } finally {
      setDaysLoading(false);
    }
  }, []);

  const loadMoreDays = useCallback(async () => {
    if (daysLoading || !daysHasMore) return;
    setDaysLoading(true);
    setError('');
    try {
      const next = await fetchLogDays({ limit: 60, offset: daysOffset });
      setDayRows(prev => [...prev, ...next]);
      setDaysOffset(o => o + next.length);
      setDaysHasMore(next.length === 60);
    } catch (e) {
      setError(e.message);
      setDaysHasMore(false);
    } finally {
      setDaysLoading(false);
    }
  }, [daysLoading, daysHasMore, daysOffset]);

  // Refresh the report too if the edited day is part of it.
  async function refreshAfterEdit() {
    await reloadSelectedDay();
    await reloadDayList();
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

  // Open focused on today: build today's report + load the browse list.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial report load
    void buildReport([getLocalDateISO()]);
  }, [buildReport]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async day list load
    void reloadDayList();
  }, [reloadDayList]);

  const selectionLabel = useMemo(() => {
    if (selDates.length === 0) return 'No days selected.';
    if (selDates.length === 1) return `1 day · ${selDates[0]}`;
    const sorted = [...selDates].sort();
    return `${selDates.length} days · ${sorted[0]} → ${sorted[sorted.length - 1]}`;
  }, [selDates]);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 20 }}>History & Trends</h1>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      {/* ── Selection card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>Review nutrition</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9ca3af' }}>
          Pick a day, several days, or a range — then view the breakdown below.
        </p>

        {/* Mode toggle + presets */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'inline-flex', gap: 4, background: '#f3f0ff', borderRadius: 10, padding: 4 }}>
            {MODES.map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => changeMode(m.key)}
                style={{
                  minHeight: 0, padding: '7px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13,
                  border: 'none', cursor: 'pointer',
                  background: mode === m.key ? '#312e81' : 'transparent',
                  color: mode === m.key ? '#fff' : '#4b5563',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {[7, 14, 30].map(n => (
              <button key={n} type="button" className="btn-secondary" style={{ minHeight: 0, padding: '7px 12px', fontSize: 13 }} onClick={() => applyPreset(n)}>
                {n}D
              </button>
            ))}
          </div>
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
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            {mode === 'range' && rangeAnchor ? `Range start ${rangeAnchor} — pick an end day.` : selectionLabel}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selDates.length > 0 && (
              <button type="button" className="btn-secondary" onClick={clearSelection}>Clear</button>
            )}
            <button type="button" className="btn-primary" disabled={selDates.length === 0 || reportLoading} onClick={viewBreakdown}>
              {reportLoading ? 'Loading…' : 'View Breakdown'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Report ── */}
      <div ref={reportRef}>
        <NutritionReport days={reportDays} loading={reportLoading} error={reportError} />
      </div>

      {/* ── Logged Day Explorer (edit/add/delete) ── */}
      <div className="card">
        <h2 className="section-title" style={{ marginBottom: 4 }}>Edit a logged day</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>
          Jump to a date to add, edit, correct, or delete meals.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Jump to date</label>
            <input type="date" value={selectedDate} onChange={handleDateChange} style={{ width: 'auto' }} />
          </div>
          {selectedDate && (
            <button type="button" className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add meal to {selectedDate}
            </button>
          )}
        </div>

        {!selectedDate && (
          <div style={{ padding: '20px 0 8px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280', fontWeight: 500 }}>No day selected.</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>
              Jump to a date or browse recent logged days below.
            </p>
          </div>
        )}

        {selectedDate && (
          <>
            <div style={{ marginBottom: 12, padding: '12px 14px', border: '1px solid #e8e4dc', borderRadius: 10, background: '#faf9f7' }}>
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

            <div style={{ marginBottom: 12 }}>
              {dayEntries.length === 0
                ? <p className="empty-state">No meals logged on {selectedDate}.</p>
                : dayEntries.map(entry => (
                  <LogEntryRow key={entry.id} entry={entry} onEdit={() => setEditEntry(entry)} onDelete={handleDeleteMeal} />
                ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0ede8' }}>
          <button
            type="button"
            onClick={() => { if (showDayList) { setVisibleDayCount(14); setShowDayList(false); } else { setShowDayList(true); } }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: '#6b7280', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5, marginBottom: showDayList ? 10 : 0 }}
          >
            <span style={{ fontSize: 10 }}>{showDayList ? '▲' : '▼'}</span>
            {showDayList ? 'Hide recent logged days' : 'Browse recent logged days'}
          </button>

          {showDayList && (
            <>
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e8e4dc', borderRadius: 10 }}>
                {dayRows.length === 0 && !daysLoading ? (
                  <p className="empty-state" style={{ padding: 18 }}>No logged days yet.</p>
                ) : (
                  dayRows.slice(0, visibleDayCount).map(d => (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => void selectDate(d.date)}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #f3f4f6', background: d.date === selectedDate ? '#f5f3ff' : '#faf9f7', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <strong style={{ fontSize: 13 }}>{d.date}</strong>
                          <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{getWeekdayLongNameFromIsoDate(d.date)}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: '#9ca3af' }}>{d.entries_count} meals</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                          <span><strong>{Math.round(d.calories)}</strong> cal</span>
                          <span>P {Number(d.protein_g).toFixed(0)}g</span>
                          <span>C {Number(d.carbs_g).toFixed(0)}g</span>
                          <span>F {Number(d.fat_g).toFixed(0)}g</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
                {visibleDayCount < dayRows.length ? (
                  <button type="button" className="btn-secondary" onClick={() => setVisibleDayCount(c => c + 14)}>Show 14 more days</button>
                ) : daysHasMore ? (
                  <button type="button" className="btn-secondary" disabled={daysLoading} onClick={async () => { await loadMoreDays(); setVisibleDayCount(c => c + 14); }}>
                    {daysLoading ? 'Loading…' : 'Load more days'}
                  </button>
                ) : (
                  <span style={{ fontSize: 13, color: '#9ca3af' }}>All days loaded</span>
                )}
                <button type="button" className="btn-secondary" disabled={daysLoading} onClick={() => { void reloadDayList(); setVisibleDayCount(14); }}>Refresh</button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddModal && (
        <LogMealModal title={`Add meal — ${selectedDate}`} submitLabel="Add Meal" onLog={handleAddMeal} onClose={() => setShowAddModal(false)} />
      )}
      {editEntry && (
        <LogMealModal title={`Edit meal — ${editEntry.date}`} submitLabel="Save Changes" initialEntry={editEntry} onLog={handleEditMeal} onClose={() => setEditEntry(null)} />
      )}
    </div>
  );
}
