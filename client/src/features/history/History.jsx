import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import RangeSelector from '@shared/ui/RangeSelector';
import { LogEntryRow } from '@features/meal-logging';
import { LogMealModal } from '@features/meal-logging';
import { fetchLogRange, fetchLogForDate, fetchLogDays, createLogEntry, createQuickFoodLog, createCustomLog, deleteLogEntry, updateLogEntry } from '@shared/api/log';
import { groupByDate, sumMacros } from '@shared/utils/macros';
import { getLocalDateISO, addDaysLocal } from '@shared/utils/dateLocal';
import { getWeekdayLongNameFromIsoDate } from '@shared/utils/weekday';
import { MACRO_COLORS } from '@shared/utils/colors';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { AdherenceCalendarMonth } from '@features/adherence';

function getRangeStart(days) {
  return addDaysLocal(getLocalDateISO(), -(days - 1));
}

export default function History() {
  const { macroUnits } = useMacroUnits();
  const [range, setRange] = useState(30);
  const [chartData, setChartData] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [dayEntries, setDayEntries] = useState([]);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [dayRows, setDayRows] = useState([]);
  const [daysLoading, setDaysLoading] = useState(false);
  const [daysHasMore, setDaysHasMore] = useState(true);
  const [daysOffset, setDaysOffset] = useState(0);
  // List collapses when a day is selected so the editor gets focus
  const [showDayList, setShowDayList] = useState(true);
  // How many locally-loaded days are currently visible in the browse list
  const [visibleDayCount, setVisibleDayCount] = useState(14);

  const dayLogRef = useRef(null);

  const selectedTotals = useMemo(() => sumMacros(dayEntries), [dayEntries]);

  // Summary stats derived from chartData — no new API calls needed.
  // Hit/partial/miss counts are intentionally omitted: they require goalsPayload
  // which History no longer loads. Add them in a future phase with goals data.
  const overviewStats = useMemo(() => {
    if (chartData.length === 0) return null;
    const n = chartData.length;
    return {
      daysLogged: n,
      avgCalories: Math.round(chartData.reduce((s, d) => s + (d.calories || 0), 0) / n),
      avgProtein:  +(chartData.reduce((s, d) => s + (d.protein_g || 0), 0) / n).toFixed(1),
      avgCarbs:    +(chartData.reduce((s, d) => s + (d.carbs_g || 0), 0) / n).toFixed(1),
      avgFat:      +(chartData.reduce((s, d) => s + (d.fat_g || 0), 0) / n).toFixed(1),
    };
  }, [chartData]);

  const loadRange = useCallback(async () => {
    try {
      const entries = await fetchLogRange(getRangeStart(range), getLocalDateISO());
      setChartData(groupByDate(entries));
    } catch (e) {
      setError(e.message);
    }
  }, [range]);

  async function selectDate(date) {
    setSelectedDate(date);
    setVisibleDayCount(14);   // always reset browse count when selection changes
    if (!date) {
      setDayEntries([]);
      setShowDayList(true);   // no selection → show the list
      return;
    }
    setShowDayList(false);    // date selected → collapse the list
    try { setDayEntries(await fetchLogForDate(date)); }
    catch (e) { setError(e.message); }
  }

  async function handleDateChange(e) {
    await selectDate(e.target.value);
  }

  // Called from AdherenceCalendarMonth "View or edit day" button
  function handleViewDay(date) {
    void selectDate(date);
    setTimeout(() => {
      dayLogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
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

  async function handleAddMeal(data) {
    if (!selectedDate) return;
    if (data?.quick_food) {
      await createQuickFoodLog({
        date: selectedDate,
        ...data.quick_food,
        notes: data.notes,
        time_min: data.time_min,
      });
    } else if (data?.log_custom) {
      await createCustomLog({
        date: selectedDate,
        ...data.log_custom,
        notes: data.notes,
        time_min: data.time_min,
      });
    } else {
      await createLogEntry({ ...data, date: selectedDate });
    }
    setShowAddModal(false);
    await reloadSelectedDay();
    await loadRange();
    await reloadDayList();
  }

  async function handleEditMeal(data) {
    if (!editEntry) return;
    await updateLogEntry(editEntry.id, data);
    setEditEntry(null);
    await reloadSelectedDay();
    await loadRange();
    await reloadDayList();
  }

  async function handleDeleteMeal(entry) {
    await deleteLogEntry(entry.id);
    await reloadSelectedDay();
    await loadRange();
    await reloadDayList();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async chart load
    void loadRange();
  }, [loadRange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async day list load
    void reloadDayList();
  }, [reloadDayList]);


  return (
    <div>
      {/* ── Page title ── */}
      <h1 className="page-title" style={{ marginBottom: 20 }}>History & Trends</h1>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      {/* ── History Overview card ── */}
      <div className="card" style={{ marginBottom: 20 }}>

        {/* Card header: section title + range selector */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, marginBottom: 4, flexWrap: 'wrap',
        }}>
          <h2 className="section-title">History Overview</h2>
          <RangeSelector value={range} onChange={setRange} />
        </div>

        {/* Days-logged context line */}
        {overviewStats && (
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>
            {overviewStats.daysLogged} day{overviewStats.daysLogged !== 1 ? 's' : ''} logged in last {range} days
          </p>
        )}

        {/* ── Summary stat chips ── */}
        {overviewStats ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 10,
            marginBottom: 24,
          }}>
            {[
              { label: 'Calories',  value: overviewStats.avgCalories.toLocaleString('en-US'), unit: 'kcal avg/day', color: MACRO_COLORS.calories },
              { label: 'Protein',   value: `${overviewStats.avgProtein}g`,  unit: 'avg/day', color: MACRO_COLORS.protein },
              { label: 'Carbs',     value: `${overviewStats.avgCarbs}g`,    unit: 'avg/day', color: MACRO_COLORS.carbs   },
              { label: 'Fat',       value: `${overviewStats.avgFat}g`,      unit: 'avg/day', color: MACRO_COLORS.fat     },
            ].map(chip => (
              <div key={chip.label} style={{
                background: '#f8f6f2', border: '1px solid #e8e4dc',
                borderRadius: 12, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: chip.color, flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#9ca3af',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                  }}>
                    {chip.label}
                  </span>
                </div>
                <div style={{
                  fontSize: 20, fontWeight: 700, color: '#111827',
                  fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                }}>
                  {chip.value}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                  {chip.unit}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: 20 }} />
        )}

        {/* ── Calorie trend chart ── */}
        <div style={{ marginBottom: 24 }}>
          <h3 className="subsection-title" style={{ marginBottom: 12 }}>Calories — last {range} days</h3>
          {chartData.length === 0 ? (
            <p className="empty-state">No data in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="calories" stroke="#f59e0b" strokeWidth={2} dot={false} name="Calories" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Macro breakdown chart ── */}
        <div>
          <h3 style={{
            margin: '0 0 4px', fontSize: 16, fontWeight: 400,
            color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
          }}>Macro breakdown — last {range} days</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
            Stacked grams per day.
          </p>
          {chartData.length === 0 ? (
            <p className="empty-state">No data in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={288}>
              <BarChart
                data={chartData}
                margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
                barCategoryGap="26%"
                barGap={2}
              >
                <CartesianGrid stroke="#ececec" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={v =>
                    typeof v === 'string' && v.length >= 10 ? `${v.slice(5, 7)}/${v.slice(8, 10)}` : v
                  }
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={v => (Number.isFinite(v) ? Math.round(v) : v)}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(243, 244, 246, 0.85)' }}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #e5e7eb',
                    fontSize: 13,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                  }}
                  labelFormatter={label => (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{getWeekdayLongNameFromIsoDate(label)}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{label}</div>
                    </div>
                  )}
                  formatter={(value, name) => [`${Number(value).toFixed(1)} g`, name]}
                />
                <Legend
                  wrapperStyle={{ paddingTop: 14 }}
                  iconType="circle"
                  iconSize={8}
                  formatter={value => <span style={{ color: '#4b5563', fontSize: 13 }}>{value}</span>}
                />
                <Bar dataKey="protein_g" stackId="macros" fill={MACRO_COLORS.protein} name="Protein" maxBarSize={56} radius={[0, 0, 0, 0]} />
                <Bar dataKey="carbs_g"   stackId="macros" fill={MACRO_COLORS.carbs}   name="Carbs"   maxBarSize={56} radius={[0, 0, 0, 0]} />
                <Bar dataKey="fat_g"     stackId="macros" fill={MACRO_COLORS.fat}      name="Fat"     maxBarSize={56} radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      {/* ── End History Overview card ── */}

      <AdherenceCalendarMonth
        macroUnits={macroUnits}
        onViewDay={handleViewDay}
      />

      {/* ── Logged Day Explorer ── */}
      <div ref={dayLogRef} className="card">
        <h2 className="section-title" style={{ marginBottom: 4 }}>Logged Day Explorer</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>
          Edit meals, correct macros, or review any past day.
        </p>

        {/* Jump to date + Add meal */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Jump to date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              style={{ width: 'auto' }}
            />
          </div>
          {selectedDate && (
            <button type="button" className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add meal to {selectedDate}
            </button>
          )}
        </div>

        {/* ── No day selected: helpful empty state ── */}
        {!selectedDate && (
          <div style={{ padding: '20px 0 8px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280', fontWeight: 500 }}>
              No day selected.
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>
              Select a day from the calendar above, jump to a date, or browse recent logged days below.
            </p>
          </div>
        )}

        {/* ── Selected day: summary + meal list ── */}
        {selectedDate && (
          <>
            <div style={{
              marginBottom: 12, padding: '12px 14px',
              border: '1px solid #e8e4dc', borderRadius: 10, background: '#faf9f7',
            }}>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                <strong style={{ color: '#1e1b4b' }}>{getWeekdayLongNameFromIsoDate(selectedDate)}</strong>
                {' · '}
                {selectedDate}
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
                  <LogEntryRow
                    key={entry.id}
                    entry={entry}
                    onEdit={() => setEditEntry(entry)}
                    onDelete={handleDeleteMeal}
                  />
                ))}
            </div>
          </>
        )}

        {/* ── Browse recent logged days (secondary / collapsible) ── */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0ede8' }}>
          <button
            type="button"
            onClick={() => {
              if (showDayList) {
                setVisibleDayCount(14);
                setShowDayList(false);
              } else {
                setShowDayList(true);
              }
            }}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 13, color: '#6b7280', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 5,
              marginBottom: showDayList ? 10 : 0,
            }}
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
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: 'none',
                        borderBottom: '1px solid #f3f4f6',
                        background: d.date === selectedDate ? '#f5f3ff' : '#faf9f7',
                        cursor: 'pointer',
                      }}
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
                  <button type="button" className="btn-secondary" onClick={() => setVisibleDayCount(c => c + 14)}>
                    Show 14 more days
                  </button>
                ) : daysHasMore ? (
                  <button type="button" className="btn-secondary" disabled={daysLoading} onClick={async () => { await loadMoreDays(); setVisibleDayCount(c => c + 14); }}>
                    {daysLoading ? 'Loading…' : 'Load more days'}
                  </button>
                ) : (
                  <span style={{ fontSize: 13, color: '#9ca3af' }}>All days loaded</span>
                )}
                <button type="button" className="btn-secondary" disabled={daysLoading} onClick={() => { void reloadDayList(); setVisibleDayCount(14); }}>
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddModal && (
        <LogMealModal
          title={`Add meal — ${selectedDate}`}
          submitLabel="Add Meal"
          onLog={handleAddMeal}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {editEntry && (
        <LogMealModal
          title={`Edit meal — ${editEntry.date}`}
          submitLabel="Save Changes"
          initialEntry={editEntry}
          onLog={handleEditMeal}
          onClose={() => setEditEntry(null)}
        />
      )}
    </div>
  );
}
