import { useEffect, useMemo, useState } from 'react';
import { fetchLogRange } from '../api/log';
import { groupByDate } from '../utils/macros';
import { addDaysLocal } from '../utils/dateLocal';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive } from '../utils/goalAdherence';
import { ISO_WEEKDAY_LABELS } from '../utils/weekday';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';
import AdherenceCalendarMonth from './AdherenceCalendarMonth';

const STATUS_META = {
  hit:       { label: 'Hit',        bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  partial:   { label: 'Partial',    bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  miss:      { label: 'Miss',       bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  upcoming:  { label: 'Upcoming',   bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  no_data:   { label: 'Not logged', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
  no_target: { label: 'No target',  bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
};

const RANGES = [
  { key: '7d',       label: '7 days',  days: 7  },
  { key: '2w',       label: '2 wks',   days: 14 },
  { key: '3w',       label: '3 wks',   days: 21 },
  { key: 'month',    label: 'Month',   days: null },
  { key: 'calendar', label: 'Calendar',days: null },
];

function Segment({ row, onOpen }) {
  const m = STATUS_META[row.status] || STATUS_META.no_target;
  const short = row.date.slice(5);
  const wd = ISO_WEEKDAY_LABELS[row.weekday] || '';
  const title = `${row.date} (${wd}): ${m.label}${
    row.missed?.length ? ` — missed: ${row.missed.map(x => x.label).join(', ')}` : ''
  }`;
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => onOpen(row)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row); }
      }}
      style={{
        /* No flex:1 — the parent grid handles sizing */
        minHeight: 52,
        background: m.bg, border: `1px solid ${m.border}`, borderRadius: 8,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: m.color, fontWeight: 600,
        padding: '4px 2px', textAlign: 'center', cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{ lineHeight: 1.2 }}>{wd.slice(0, 3)}</span>
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{short}</span>
    </div>
  );
}

/**
 * Dashboard adherence panel with selectable range views.
 * Accepts pre-loaded 7-day rows from the dashboard; fetches lazily for longer ranges.
 */
export default function DashboardAdherenceSection({ today, goalsPayload, macroUnits, rows7d }) {
  const [range, setRange] = useState('7d');
  const [extLogEntries, setExtLogEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailRow, setDetailRow] = useState(null);

  useEffect(() => {
    const opt = RANGES.find(r => r.key === range);
    // 7d uses pre-loaded data; month/calendar self-manage their own fetching
    if (!opt?.days || range === '7d') return;
    let cancelled = false;
    setLoading(true);
    const start = addDaysLocal(today, -(opt.days - 1));
    fetchLogRange(start, today)
      .then(data => { if (!cancelled) { setExtLogEntries(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setExtLogEntries([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [range, today]);

  const extRows = useMemo(() => {
    const opt = RANGES.find(r => r.key === range);
    if (!opt?.days || range === '7d') return [];
    const start = addDaysLocal(today, -(opt.days - 1));
    const dates = listLocalDatesInclusive(start, today);
    const grouped = groupByDate(extLogEntries);
    const dayList = dates.map(d => {
      const g = grouped.find(x => x.date === d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalsPayload, dayList, { todayIso: today });
  }, [range, extLogEntries, today, goalsPayload]);

  const isStrip = ['7d', '2w', '3w'].includes(range);
  const displayRows = range === '7d' ? (rows7d || []) : extRows;
  const hits = displayRows.filter(r => r.status === 'hit').length;
  const withTargets = displayRows.filter(r => r.status !== 'no_target').length;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {/* ── Header + range tabs ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 14, gap: 8, flexWrap: 'wrap',
      }}>
        <div>
          <p style={{
            margin: 0, fontSize: 22, fontWeight: 400, color: '#1e1b4b',
            fontFamily: "'DM Serif Display', Georgia, serif",
          }}>
            Goal Adherence
          </p>
          {isStrip && withTargets > 0 && !loading && (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280' }}>
              <strong style={{ color: '#111827' }}>{hits}</strong>/{displayRows.length} days on target
            </p>
          )}
        </div>

        {/* Segmented tab selector */}
        <div style={{
          display: 'flex', gap: 2, background: '#f0ede8',
          borderRadius: 10, padding: 3, flexShrink: 0,
        }}>
          {RANGES.map(opt => {
            const isActive = range === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                aria-pressed={isActive}
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  padding: '5px 9px',
                  borderRadius: 7,
                  border: 'none',
                  background: isActive ? '#faf9f7' : 'transparent',
                  color: isActive ? '#1e1b4b' : '#6b7280',
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>Loading…</p>
      )}

      {/* ── Strip view: 7d / 2w / 3w ── */}
      {isStrip && !loading && (
        <>
          {displayRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
              No goal data yet — set goals to start tracking adherence.
            </p>
          ) : (
            /* 7-column grid: 7d = 1 row, 14d = 2 rows, 21d = 3 rows */
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 6,
            }}>
              {displayRows.map(row => (
                <Segment key={row.date} row={row} onOpen={setDetailRow} />
              ))}
            </div>
          )}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
            {['hit', 'partial', 'miss'].map(s => (
              <span
                key={s}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: STATUS_META[s].border, display: 'inline-block', flexShrink: 0,
                }} />
                {STATUS_META[s].label}
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── Month view: current month, no prev/next ── */}
      {range === 'month' && !loading && (
        <AdherenceCalendarMonth macroUnits={macroUnits} bare showNav={false} />
      )}

      {/* ── Calendar view: navigable month grid ── */}
      {range === 'calendar' && !loading && (
        <AdherenceCalendarMonth macroUnits={macroUnits} bare />
      )}

      {/* Day detail dialog for strip views */}
      {detailRow && (
        <GoalAdherenceDayDetailDialog
          key={detailRow.date}
          row={detailRow}
          macroUnits={macroUnits}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
