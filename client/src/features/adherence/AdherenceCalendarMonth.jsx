import { useEffect, useMemo, useState } from 'react';
import { fetchLogRange } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { groupByDate } from '@shared/utils/macros';
import { addDaysLocal, getLocalDateISO, parseLocalDateISO } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, buildDayAdherenceDetail, hasAnyTarget } from './goalAdherence';
import { getIsoWeekday, ISO_WEEKDAY_LABELS, SUNDAY_FIRST_WEEKDAYS, sundayFirstIndex } from '@shared/utils/weekday';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';
import { STATUS_META } from './statusMeta';

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
 * @param {string[]} [props.selectedDates] - Opt-in selection mode: ISO dates to highlight as selected
 * @param {function} [props.onDayClick]    - Opt-in: when set, clicking a day calls onDayClick(date) instead of opening the detail dialog
 * @param {number}   [props.dayMinHeight=52] - Minimum height of each day tile (raise for a larger, roomier calendar)
 * @param {boolean}  [props.hideHeader=false] - Hides the "Adherence calendar" title/hint (keeps month nav) when the host section provides its own heading
 * @param {boolean}  [props.inlineDetail=false] - With onDayClick: clicking a day ALSO drops an inline detail panel below the grid (instead of the modal dialog)
 */
export default function AdherenceCalendarMonth({ macroUnits, bare = false, showNav = true, onViewDay = null, selectedDates = null, onDayClick = null, dayMinHeight = 52, hideHeader = false, inlineDetail = false }) {
  const [month, setMonth] = useState(() => getLocalDateISO().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [goalRows, setGoalRows] = useState(null);
  const [monthTotals, setMonthTotals] = useState([]);
  const [detailRow, setDetailRow] = useState(null);

  const monthDates = useMemo(() => datesInMonth(month), [month]);
  const selectedSet = useMemo(() => new Set(selectedDates || []), [selectedDates]);

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

  const blanks = sundayFirstIndex(firstWeekday); // leading tiles before a Sunday-first grid

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: hideHeader ? 'flex-end' : 'space-between', gap: 12, marginBottom: 12 }}>
        {!hideHeader && (
          <div>
            <h3 className="section-title">Adherence calendar</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
              {onDayClick ? 'Click days to add them to your selection.' : 'Month view. Click a day for details.'}
            </p>
          </div>
        )}
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
        {SUNDAY_FIRST_WEEKDAYS.map(k => (
          <div key={k} style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', fontWeight: 600 }}>
            {ISO_WEEKDAY_LABELS[k].slice(0, 3)}
          </div>
        ))}
        {Array.from({ length: blanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {dayRows.map(row => {
          const m = STATUS_META[row.status] || STATUS_META.no_target;
          const dayNum = Number(row.date.slice(8, 10));
          const hasTarget = hasAnyTarget(row.targets);
          const isSelected = selectedSet.has(row.date);
          return (
            <div
              key={row.date}
              role="button"
              tabIndex={0}
              className="cal-day"
              onClick={() => {
                if (onDayClick) {
                  onDayClick(row.date);
                  if (inlineDetail) setDetailRow(row);
                } else {
                  setDetailRow(row);
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onDayClick) {
                    onDayClick(row.date);
                    if (inlineDetail) setDetailRow(row);
                  } else {
                    setDetailRow(row);
                  }
                }
              }}
              title={row.date}
              style={{
                borderRadius: 10,
                border: isSelected ? '2px solid #7c3aed' : `1px solid ${m.border}`,
                background: isSelected ? '#f5f3ff' : (hasTarget ? m.bg : 'transparent'),
                boxShadow: isSelected ? '0 0 0 2px rgba(124, 58, 237, 0.22)' : 'none',
                minHeight: dayMinHeight,
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

      {/* Inline day detail: drops down under the grid as days are clicked,
          updating in place instead of interrupting with a modal. */}
      {inlineDetail && detailRow && (() => {
        const detail = buildDayAdherenceDetail(detailRow.totals, detailRow.targets, macroUnits, {
          status: detailRow.status,
          hasData: detailRow.hasData,
        });
        if (!detail) return null;
        const statusM = STATUS_META[detailRow.status] || STATUS_META.no_target;
        const wdName = ISO_WEEKDAY_LABELS[detailRow.weekday] || '';
        return (
          <div
            key={detailRow.date}
            className="panel-in"
            style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${statusM.border}`, background: statusM.bg }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>{wdName}</strong>{' · '}{detailRow.date}{' · '}
                <span style={{ fontWeight: 600, padding: '1px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.65)', color: statusM.color }}>
                  {statusM.label}
                </span>
                {detail.missed?.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#92400e' }}>
                    Off-target: {detail.missed.map(m => m.label).join(', ')}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                aria-label="Dismiss day detail"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: statusM.color, padding: '2px 6px' }}
              >
                ✕
              </button>
            </div>

            {detailRow.status === 'no_data' && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>No meals were logged for this day.</p>
            )}
            {detailRow.status === 'upcoming' && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>This day is in the future. No meals logged yet.</p>
            )}

            {detailRow.status !== 'no_data' && detailRow.status !== 'upcoming' && (
              <>
                <div className="adh-detail-table" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: `1px solid ${statusM.border}` }}>
                        <th style={{ padding: '6px 8px 6px 0' }}>Category</th>
                        <th style={{ padding: 6 }}>Goal</th>
                        <th style={{ padding: 6 }}>Actual</th>
                        <th style={{ padding: 6 }}>vs goal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.categories.map(cat => (
                        <tr key={cat.key} style={{ fontWeight: cat.missedTolerance ? 600 : 400 }}>
                          <td style={{ padding: '5px 8px 5px 0' }}>{cat.label}</td>
                          <td style={{ padding: 5 }}>{cat.goalDisplay}</td>
                          <td style={{ padding: 5 }}>{cat.actualDisplay}</td>
                          <td style={{ padding: 5 }}>{cat.deltaLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile: stacked per-category cards (no horizontal scroll) */}
                <div className="adh-detail-cards">
                  {detail.categories.map(cat => (
                    <div key={cat.key} className="adh-detail-cat">
                      <div className="adh-detail-cat-name">{cat.label}</div>
                      <div className="adh-detail-cat-row"><span>Goal</span><span>{cat.goalDisplay}</span></div>
                      <div className="adh-detail-cat-row"><span>Actual</span><span>{cat.actualDisplay}</span></div>
                      <div className="adh-detail-cat-row"><span>vs goal</span><span>{cat.deltaLabel}</span></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {!inlineDetail && detailRow && (
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

