import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLogRange } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchSupplementRange } from '@shared/api/supplements';
import { fetchDietPhases } from '@shared/api/dietPhases';
import { groupByDate, sumSupplementMacros, addMacroTotals } from '@shared/utils/macros';
import { addDaysLocal, formatDisplayDate, getLocalDateISO, parseLocalDateISO } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, hasAnyTarget } from './goalAdherence';
import { getIsoWeekday, ISO_WEEKDAY_LABELS, SUNDAY_FIRST_WEEKDAYS, sundayFirstIndex } from '@shared/utils/weekday';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';
import DayAdherencePopover from './DayAdherencePopover';
import { STATUS_META } from './statusMeta';
import { PHASE_META, phaseTitle } from './phaseMeta';
import DietPhaseDialog from './DietPhaseDialog';

/**
 * How long a pointer must rest on a day before its detail appears. Long enough
 * that scanning across the grid doesn't flash popovers, short enough not to
 * feel broken. Tune here — it's the only place the delay is defined.
 */
const HOVER_DELAY_MS = 500;

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
 *
 * Day detail is shown by hovering (or long-pressing) a tile — see
 * DayAdherencePopover. Clicking is reserved for selection when `onDayClick` is
 * set, so the two jobs never fight over the same gesture.
 */
export default function AdherenceCalendarMonth({ macroUnits, bare = false, showNav = true, onViewDay = null, selectedDates = null, onDayClick = null, dayMinHeight = 52, hideHeader = false, focusMonth = null }) {
  const [month, setMonth] = useState(() => focusMonth || getLocalDateISO().slice(0, 7)); // YYYY-MM

  // Follow the host's focus month. A preset like "last 30 days" starts in the
  // PREVIOUS month, so without this the grid stayed on the current month and
  // showed 2 of the 30 selected days — the rest sat on a page you couldn't see,
  // which made the preset look like it had done nothing.
  //
  // Adjusted during render rather than in an effect (React's documented pattern
  // for syncing state to a prop): an effect would render the stale month first
  // and then immediately re-render, and it trips the repo's set-state-in-effect
  // rule. The guard means the arrows still page freely — this only fires when
  // the host actually changes its focus.
  const [lastFocusMonth, setLastFocusMonth] = useState(focusMonth);
  if (focusMonth && focusMonth !== lastFocusMonth) {
    setLastFocusMonth(focusMonth);
    setMonth(focusMonth);
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [goalRows, setGoalRows] = useState(null);
  const [monthTotals, setMonthTotals] = useState([]);
  // Macros from macro-counting supplements, per date — folded into each day's
  // totals so a day is judged on everything that counted toward its goals.
  const [suppTotalsByDate, setSuppTotalsByDate] = useState({});
  const [detailRow, setDetailRow] = useState(null);
  // Hover/long-press detail. Stores the DATE, not the row — the row is looked
  // up from dayRows at render so it can never go stale behind a data reload.
  const [hovered, setHovered] = useState(null); // { date, rect }
  const hoverTimer = useRef(null);
  // Diet-phase badges. Loaded apart from adherence so a failure here never
  // blanks the month; phasesVersion bumps after an add/edit/delete.
  const [phases, setPhases] = useState([]);
  const [phasesVersion, setPhasesVersion] = useState(0);
  const [phaseDialog, setPhaseDialog] = useState(null); // { phase } | { defaultStart }

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
        // Supplements are best-effort: a failure there must not blank the month.
        const [entries, goalsRes, suppRange] = await Promise.all([
          fetchLogRange(start, end),
          fetchGoals({ date: end }),
          fetchSupplementRange(start, end).catch(() => ({ byDate: {} })),
        ]);
        if (cancelled) return;
        const byDate = suppRange?.byDate || {};
        const suppTotals = {};
        for (const [date, list] of Object.entries(byDate)) {
          suppTotals[date] = sumSupplementMacros(list);
        }
        setMonthTotals(groupByDate(entries));
        setSuppTotalsByDate(suppTotals);
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
      const supp = suppTotalsByDate[d];
      // A day counts as logged if it has meals or supplement macros that count.
      const hasSuppMacros = !!supp && (supp.calories > 0 || supp.protein_g > 0 || supp.carbs_g > 0 || supp.fat_g > 0);
      if (!g && !hasSuppMacros) {
        return { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
      }
      return { date: d, ...addMacroTotals(g, supp), hasData: true };
    });
    return buildWeeklyAdherenceRows(goalRows, dayList, { todayIso: getLocalDateISO() });
  }, [goalRows, monthTotals, monthDates, suppTotalsByDate]);

  const firstWeekday = useMemo(() => {
    const d0 = monthStartIso(month);
    return getIsoWeekday(parseLocalDateISO(d0)); // 1..7 (Mon..Sun)
  }, [month]);

  const blanks = sundayFirstIndex(firstWeekday); // leading tiles before a Sunday-first grid

  function closeDetail() {
    clearTimeout(hoverTimer.current);
    setHovered(null);
  }

  /** Arm the hover detail. Keyboard focus opens immediately (delay 0). */
  function openDetailAfterDelay(date, el, delay = HOVER_DELAY_MS) {
    clearTimeout(hoverTimer.current);
    const rect = el.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHovered({ date, rect }), delay);
  }

  // Don't leave a pending timer behind on unmount or month change.
  useEffect(() => closeDetail, [month]);

  const hoveredRow = hovered ? dayRows.find(r => r.date === hovered.date) : null;

  // Selection can span months; say so rather than silently showing part of it.
  const offscreenSelected = useMemo(() => {
    if (!selectedDates?.length) return { before: 0, after: 0 };
    let before = 0;
    let after = 0;
    for (const d of selectedDates) {
      const m = d.slice(0, 7);
      if (m < month) before += 1;
      else if (m > month) after += 1;
    }
    return { before, after };
  }, [selectedDates, month]);

  // Fill the leading/trailing grid cells with the real dates from the adjacent
  // months (recessed) so the calendar always reads as a full rectangle instead
  // of a grid with blank holes in the corners.
  const leadingDates = useMemo(() => {
    const out = [];
    let d = monthStartIso(month);
    for (let i = 0; i < blanks; i++) { d = addDaysLocal(d, -1); out.unshift(d); }
    return out;
  }, [month, blanks]);
  const trailingDates = useMemo(() => {
    const trailing = (7 - ((blanks + monthDates.length) % 7)) % 7;
    const out = [];
    let d = monthEndIso(month);
    for (let i = 0; i < trailing; i++) { d = addDaysLocal(d, 1); out.push(d); }
    return out;
  }, [month, blanks, monthDates.length]);

  const gridStart = leadingDates[0] || monthStartIso(month);
  const gridEnd = trailingDates[trailingDates.length - 1] || monthEndIso(month);
  useEffect(() => {
    let cancelled = false;
    fetchDietPhases({ start: gridStart, end: gridEnd })
      .then(list => { if (!cancelled) setPhases(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setPhases([]); });
    return () => { cancelled = true; };
  }, [gridStart, gridEnd, phasesVersion]);

  /** Phases covering a date, oldest first (as the server sorts them). */
  const phasesOn = d => phases.filter(p => p.start_date <= d && p.effective_end_date >= d);

  const monthPhases = useMemo(
    () => phases.filter(p => p.start_date <= monthEndIso(month) && p.effective_end_date >= monthStartIso(month)),
    [phases, month]
  );

  function openPhase(e, phase) {
    e.stopPropagation();
    closeDetail();
    setPhaseDialog({ phase });
  }

  /** Thin colored bars along the tile's foot, one per phase covering the day. */
  const renderPhaseBars = d => {
    const on = phasesOn(d);
    if (!on.length) return null;
    return (
      <div className="cal-phase-bars" aria-hidden="true">
        {on.slice(0, 3).map(p => (
          <span key={p.id} style={{ background: PHASE_META[p.kind]?.color || PHASE_META.other.color }} />
        ))}
      </div>
    );
  };

  const renderOutsideDay = d => (
    <div key={`out-${d}`} className="cal-day cal-day--outside" aria-hidden="true" style={{ minHeight: dayMinHeight }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-faint)' }}>{Number(d.slice(8, 10))}</span>
      {renderPhaseBars(d)}
    </div>
  );

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: hideHeader ? 'flex-end' : 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        {!hideHeader && (
          <div>
            <h3 className="section-title">Adherence calendar</h3>
          </div>
        )}
        <button
          type="button"
          className="btn-secondary cal-phase-add"
          onClick={() => setPhaseDialog({ defaultStart: getLocalDateISO() })}
          title="Mark when a cut, bulk, or maintenance stretch starts"
          style={{ marginLeft: hideHeader ? 0 : 'auto', marginRight: hideHeader ? 'auto' : 0 }}
        >
          + Phase
        </button>
        {showNav && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="day-nav-btn" onClick={prevMonth} aria-label="Previous month" style={{ width: 40, height: 40 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
            <strong style={{ fontSize: 14, color: 'var(--color-text-body)', minWidth: 128, textAlign: 'center' }}>
              {monthLabel(month)}
            </strong>
            <button type="button" className="day-nav-btn" onClick={nextMonth} aria-label="Next month" style={{ width: 40, height: 40 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
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
      {loading ? (
        <div
          aria-busy="true"
          style={{
            marginTop: 10,
            minHeight: dayMinHeight * 5 + 40,
            borderRadius: 12,
            border: '1px solid var(--color-surface-border)',
            background: '#f8f6f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-faint)',
            fontSize: 13,
          }}
        >
          Loading calendar…
        </div>
      ) : (
      <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', marginTop: 10 }}>
        {SUNDAY_FIRST_WEEKDAYS.map(k => (
          <div key={k} style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', fontWeight: 600 }}>
            {ISO_WEEKDAY_LABELS[k].slice(0, 3)}
          </div>
        ))}
        {leadingDates.map(renderOutsideDay)}
        {dayRows.map(row => {
          const m = STATUS_META[row.status] || STATUS_META.no_target;
          const dayNum = Number(row.date.slice(8, 10));
          const hasTarget = hasAnyTarget(row.targets);
          const isSelected = selectedSet.has(row.date);
          const covering = phasesOn(row.date);
          const starting = covering.filter(p => p.start_date === row.date);
          return (
            <div
              key={row.date}
              role="button"
              tabIndex={0}
              className="cal-day"
              onClick={() => {
                if (onDayClick) onDayClick(row.date);
                else setDetailRow(row);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onDayClick) onDayClick(row.date);
                  else setDetailRow(row);
                }
              }}
              // Rest a pointer here to see the day's numbers; on touch the same
              // gesture is a long press. Clicking still only ever selects.
              onMouseEnter={e => openDetailAfterDelay(row.date, e.currentTarget)}
              onMouseLeave={closeDetail}
              onTouchStart={e => openDetailAfterDelay(row.date, e.currentTarget)}
              onTouchEnd={closeDetail}
              onTouchMove={closeDetail}
              onFocus={e => openDetailAfterDelay(row.date, e.currentTarget, 0)}
              onBlur={closeDetail}
              title={covering.length ? `${row.date} · ${covering.map(phaseTitle).join(', ')}` : row.date}
              style={{
                borderRadius: 10,
                border: isSelected ? '2px solid var(--color-primary)' : `1px solid ${m.border}`,
                background: isSelected ? 'var(--color-primary-subtle)' : (hasTarget ? m.bg : 'transparent'),
                boxShadow: isSelected ? '0 0 0 2px rgba(29, 78, 216, 0.22)' : 'none',
                minHeight: dayMinHeight,
                position: 'relative',
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 13, color: 'var(--color-text-strong)' }}>{dayNum}</strong>
              </div>
              {starting.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="cal-phase-badge"
                  style={{ '--phase-color': PHASE_META[p.kind]?.color || PHASE_META.other.color }}
                  onClick={e => openPhase(e, p)}
                  onKeyDown={e => e.stopPropagation()}
                  aria-label={`${phaseTitle(p)} starts ${p.start_date}. Edit phase`}
                >
                  {phaseTitle(p)}
                </button>
              ))}
              <div className="cal-day-note" style={{ color: m.color }}>
                {hasTarget && row.status !== 'no_target' ? (STATUS_META[row.status]?.label || '') : ''}
              </div>
              {renderPhaseBars(row.date)}
            </div>
          );
        })}
        {trailingDates.map(renderOutsideDay)}
      </div>
      )}

      <ul className="cal-legend" aria-label="Adherence legend">
        {['hit', 'partial', 'miss', 'upcoming'].map(key => (
          <li key={key}>
            <span className="cal-legend-swatch" style={{ background: STATUS_META[key].bg, borderColor: STATUS_META[key].border }} />
            {STATUS_META[key].label}
          </li>
        ))}
      </ul>

      {monthPhases.length > 0 && (
        <ul className="cal-phase-list" aria-label="Diet phases this month">
          {monthPhases.map(p => (
            <li key={p.id}>
              <button
                type="button"
                className="cal-phase-chip"
                style={{ '--phase-color': PHASE_META[p.kind]?.color || PHASE_META.other.color }}
                onClick={e => openPhase(e, p)}
              >
                <span className="cal-phase-chip__dot" aria-hidden="true" />
                <strong>{phaseTitle(p)}</strong>
                <span className="cal-phase-chip__dates">
                  {formatDisplayDate(p.start_date)} → {p.ongoing ? 'ongoing' : formatDisplayDate(p.effective_end_date)}
                </span>
                {p.source === 'mcp' && <span className="cal-phase-chip__src" title="Added by your AI assistant">AI</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {phaseDialog && (
        <DietPhaseDialog
          phase={phaseDialog.phase || null}
          defaultStart={phaseDialog.defaultStart || null}
          onClose={() => setPhaseDialog(null)}
          onSaved={() => setPhasesVersion(v => v + 1)}
        />
      )}

      {(offscreenSelected.before > 0 || offscreenSelected.after > 0) && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-text-faint)' }}>
          {offscreenSelected.before > 0 && (
            <>← {offscreenSelected.before} selected day{offscreenSelected.before === 1 ? '' : 's'} in the previous month</>
          )}
          {offscreenSelected.before > 0 && offscreenSelected.after > 0 && ' · '}
          {offscreenSelected.after > 0 && (
            <>{offscreenSelected.after} selected day{offscreenSelected.after === 1 ? '' : 's'} in the next month →</>
          )}
        </p>
      )}

      {/* Day detail on hover / long press. Reads the live row out of
          dayRows, so a data reload can never leave it showing stale numbers. */}
      {hoveredRow && (
        <DayAdherencePopover row={hoveredRow} rect={hovered.rect} macroUnits={macroUnits} />
      )}

      {/* Modal detail, only on the standalone calendar — when `onDayClick` is
          set the click belongs to selection and detailRow is never filled. */}
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

