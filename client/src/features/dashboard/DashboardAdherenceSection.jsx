import { useEffect, useMemo, useState } from 'react';
import { fetchLogRange } from '@shared/api/log';
import { groupByDate } from '@shared/utils/macros';
import { addDaysLocal } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive } from '@features/adherence';
import { ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';
import { GoalAdherenceDayDetailDialog } from '@features/adherence';
import { AdherenceCalendarMonth } from '@features/adherence';
import { STATUS_META } from '@features/adherence';

const MAX_CUSTOM_DAYS = 92;

const RANGES = [
  { key: '7d',       label: '7 days',  days: 7  },
  { key: '2w',       label: '2 wks',   days: 14 },
  { key: '3w',       label: '3 wks',   days: 21 },
  { key: 'calendar', label: 'Calendar',days: null },
  { key: 'custom',   label: 'Custom',  days: null },
];

function daysBetweenInclusive(startIso, endIso) {
  const [ay, am, ad] = startIso.split('-').map(Number);
  const [by, bm, bd] = endIso.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000) + 1;
}

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
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Validation for the custom range (incomplete dates are allowed silently).
  const customError = useMemo(() => {
    if (range !== 'custom' || !customStart || !customEnd) return '';
    if (customStart > customEnd) return "Start date can't be after end date.";
    if (daysBetweenInclusive(customStart, customEnd) > MAX_CUSTOM_DAYS) {
      return `Please choose a range of ${MAX_CUSTOM_DAYS} days or fewer.`;
    }
    return '';
  }, [range, customStart, customEnd]);

  // Resolved [start, end] used for fetching + row building. null = nothing to show.
  const bounds = useMemo(() => {
    if (range === 'custom') {
      if (!customStart || !customEnd || customStart > customEnd) return null;
      if (daysBetweenInclusive(customStart, customEnd) > MAX_CUSTOM_DAYS) return null;
      return { start: customStart, end: customEnd };
    }
    const opt = RANGES.find(r => r.key === range);
    if (!opt?.days || range === '7d') return null; // 7d uses preloaded rows; calendar is separate
    return { start: addDaysLocal(today, -(opt.days - 1)), end: today };
  }, [range, customStart, customEnd, today]);

  useEffect(() => {
    // 7d uses pre-loaded rows; calendar self-manages; invalid/empty custom fetches nothing.
    if (range === '7d' || range === 'calendar' || !bounds) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchLogRange(bounds.start, bounds.end)
      .then(data => { if (!cancelled) { setExtLogEntries(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setExtLogEntries([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [range, bounds]);

  const extRows = useMemo(() => {
    if (range === '7d' || range === 'calendar' || !bounds) return [];
    const dates = listLocalDatesInclusive(bounds.start, bounds.end);
    const grouped = groupByDate(extLogEntries);
    const dayList = dates.map(d => {
      const g = grouped.find(x => x.date === d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalsPayload, dayList, { todayIso: today });
  }, [range, bounds, extLogEntries, today, goalsPayload]);

  const isStrip = ['7d', '2w', '3w', 'custom'].includes(range);
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
          <p className="section-title">Goal Adherence</p>
          {isStrip && withTargets > 0 && !loading && (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-text-strong)' }}>{hits}</strong>/{displayRows.length} days on target
            </p>
          )}
        </div>

        {/* Segmented tab selector */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 2, background: 'var(--color-divider-warm)',
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
                  background: isActive ? 'var(--color-surface)' : 'transparent',
                  color: isActive ? 'var(--color-primary-ink)' : 'var(--color-text-muted)',
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

      {/* ── Custom range date inputs ── */}
      {range === 'custom' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label htmlFor="adh-start" style={{ marginBottom: 4 }}>Start date</label>
              <input
                id="adh-start"
                type="date"
                value={customStart}
                max={customEnd || today}
                onChange={e => setCustomStart(e.target.value)}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label htmlFor="adh-end" style={{ marginBottom: 4 }}>End date</label>
              <input
                id="adh-end"
                type="date"
                value={customEnd}
                min={customStart || undefined}
                max={today}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </div>
          </div>
          {customError && <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>{customError}</p>}
        </div>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>Loading…</p>
      )}

      {/* ── Strip view: 7d / 2w / 3w / custom ── */}
      {isStrip && !loading && (
        <>
          {range === 'custom' && (!customStart || !customEnd) ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
              Pick a start and end date to view adherence.
            </p>
          ) : range === 'custom' && customError ? (
            /* validation message already shown under the date inputs */
            null
          ) : displayRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
              No goal data yet — set goals to start tracking adherence.
            </p>
          ) : range === 'custom' && extLogEntries.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
              No meals logged between {customStart} and {customEnd}.
            </p>
          ) : (
            <>
              {/* 7-column grid: rows wrap as needed for the range length */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gap: 6,
              }}>
                {displayRows.map(row => (
                  <Segment key={row.date} row={row} onOpen={setDetailRow} />
                ))}
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                {['hit', 'partial', 'miss'].map(s => (
                  <span
                    key={s}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}
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
        </>
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
