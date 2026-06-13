import { useEffect, useMemo, useState } from 'react';
import { fetchLogRange } from '../api/log';
import { fetchGoals } from '../api/goals';
import { groupByDate } from '../utils/macros';
import { addDaysLocal, getLocalDateISO, parseLocalDateISO } from '../utils/dateLocal';
import { buildWeeklyAdherenceRows, hasAnyTarget } from '../utils/goalAdherence';
import { getIsoWeekday, ISO_WEEKDAY_LABELS } from '../utils/weekday';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';
import { STATUS_META } from '../utils/statusMeta';

// Compact metric labels so missed-macro text fits inside small calendar tiles.
const SHORT_METRIC = { Calories: 'Cal', Protein: 'Pro', Carbs: 'Carb', Fat: 'Fat', Fiber: 'Fib' };
function shortMetric(label) {
  return SHORT_METRIC[label] || label;
}

function monthStartIso(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return getLocalDateISO(new Date(y, m - 1, 1));
}

function monthEndIso(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  // day 0 of next month = last day of this month
  return getLocalDateISO(new Date(y, m, 0));
}

function monthLabel(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function datesInMonth(yyyyMm) {
  const start = monthStartIso(yyyyMm);
  const end = monthEndIso(yyyyMm);
  const out = [];
  let cur = start;
  for (let i = 0; i < 40; i++) {
    out.push(cur);
    if (cur === end) break;
    cur = addDaysLocal(cur, 1);
  }
  return out;
}

/**
 * @param {object} props
 * @param {'metric'|'us'} props.macroUnits
 * @param {boolean}  [props.bare=false]     - When true, omits the outer .card wrapper (for embedding)
 * @param {boolean}  [props.showNav=true]  - When false, hides the prev/next month navigation
 * @param {function} [props.onViewDay]     - Optional callback(dateStr) fired when user clicks "View or edit day"
 */
export default function AdherenceCalendarMonth({ macroUnits, bare = false, showNav = true, onViewDay = null }) {
  const [month, setMonth] = useState(() => getLocalDateISO().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [goalRows, setGoalRows] = useState(null);
  const [monthTotals, setMonthTotals] = useState([]);
  const [detailRow, setDetailRow] = useState(null);

  const monthDates = useMemo(() => datesInMonth(month), [month]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const start = monthStartIso(month);
        const end = monthEndIso(month);
        const [entries, goalsRes] = await Promise.all([fetchLogRange(start, end), fetchGoals({ date: end })]);
        if (cancelled) return;
        setMonthTotals(groupByDate(entries));
        setGoalRows(goalsRes || null);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load adherence calendar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const dayRows = useMemo(() => {
    const totalsByDate = new Map(monthTotals.map(r => [r.date, r]));
    const dayList = monthDates.map(d => {
      const g = totalsByDate.get(d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalRows, dayList, { todayIso: getLocalDateISO() });
  }, [goalRows, monthTotals, monthDates]);

  const firstWeekday = useMemo(() => {
    const d0 = monthStartIso(month);
    return getIsoWeekday(parseLocalDateISO(d0)); // 1..7 (Mon..Sun)
  }, [month]);

  const blanks = firstWeekday - 1; // days before Monday start

  function prevMonth() {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(y, m - 2, 1);
    setMonth(getLocalDateISO(dt).slice(0, 7));
  }
  function nextMonth() {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(y, m, 1);
    setMonth(getLocalDateISO(dt).slice(0, 7));
  }

  const inner = (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <h3 className="section-title">Adherence calendar</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Month view. Click a day for details.
          </p>
        </div>
        {showNav && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={prevMonth} style={{ padding: '6px 10px' }}>
              ←
            </button>
            <strong style={{ fontSize: 14, color: 'var(--color-text-body)', minWidth: 160, textAlign: 'center' }}>
              {monthLabel(month)}
            </strong>
            <button type="button" className="btn-secondary" onClick={nextMonth} style={{ padding: '6px 10px' }}>
              →
            </button>
          </div>
        )}
        {!showNav && (
          <strong style={{ fontSize: 14, color: 'var(--color-text-body)' }}>
            {monthLabel(month)}
          </strong>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>}

      <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', marginTop: 10 }}>
        {Object.entries(ISO_WEEKDAY_LABELS).map(([k, v]) => (
          <div key={k} style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', fontWeight: 600 }}>
            {v.slice(0, 3)}
          </div>
        ))}
        {Array.from({ length: blanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {dayRows.map(row => {
          const m = STATUS_META[row.status] || STATUS_META.no_target;
          const dayNum = Number(row.date.slice(8, 10));
          const hasTarget = hasAnyTarget(row.targets);
          return (
            <div
              key={row.date}
              role="button"
              tabIndex={0}
              className="cal-day"
              onClick={() => setDetailRow(row)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailRow(row);
                }
              }}
              title={row.date}
              style={{
                borderRadius: 10,
                border: `1px solid ${m.border}`,
                background: hasTarget ? m.bg : 'transparent',
                minHeight: 52,
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 13, color: 'var(--color-text-strong)' }}>{dayNum}</strong>
                {hasTarget && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.color }}>
                    {row.status === 'no_target'
                      ? ''
                      : row.status === 'no_data'
                        ? '—'
                        : row.status === 'upcoming'
                          ? '↗'
                          : row.status.toUpperCase().slice(0, 1)}
                  </span>
                )}
              </div>
              {hasTarget && row.status !== 'hit' && row.missed?.length ? (
                <div className="cal-day-missed" style={{ color: m.color }}>
                  {row.missed.slice(0, 3).map(x => shortMetric(x.label)).join(' ')}
                  {row.missed.length > 3 ? ` +${row.missed.length - 3}` : ''}
                </div>
              ) : (
                <div className="cal-day-note">
                  {hasTarget
                    ? row.status === 'hit'
                      ? 'Hit'
                      : row.status === 'no_data'
                        ? 'Not logged'
                        : row.status === 'upcoming'
                          ? 'Upcoming'
                          : ''
                    : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailRow && (
        <GoalAdherenceDayDetailDialog
          key={detailRow.date}
          row={detailRow}
          macroUnits={macroUnits}
          onClose={() => setDetailRow(null)}
          onViewDay={onViewDay ? (date) => {
            setDetailRow(null);
            onViewDay(date);
          } : null}
        />
      )}
    </div>
  );

  if (bare) return inner;
  return <div className="card" style={{ marginBottom: 20 }}>{inner}</div>;
}

