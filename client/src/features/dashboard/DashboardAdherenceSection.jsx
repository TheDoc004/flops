import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLogRange } from '@shared/api/log';
import { groupByDate } from '@shared/utils/macros';
import { addDaysLocal } from '@shared/utils/dateLocal';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive } from '@features/adherence';
import { GoalAdherenceDayDetailDialog } from '@features/adherence';
import { AdherenceCalendarMonth } from '@features/adherence';
import { AdherenceDayTile } from '@features/adherence';
import { STATUS_META } from '@features/adherence';

// The dashboard shows exactly one adherence view — chosen in Profile
// (dash_adherence_view), not toggled here. Range exploration lives on the
// History page.
const VIEW_META = {
  '7d':      { label: 'Last 7 days',  days: 7 },
  '2w':      { label: 'Last 2 weeks', days: 14 },
  '3w':      { label: 'Last 3 weeks', days: 21 },
  calendar:  { label: 'This month',   days: null },
};

/**
 * Dashboard adherence panel. Renders the single view configured in Profile:
 * pre-loaded 7-day rows straight from the dashboard, a lazily-fetched 2/3-week
 * strip, or the month calendar.
 */
export default function DashboardAdherenceSection({ today, goalsPayload, macroUnits, rows7d, view = '7d' }) {
  const meta = VIEW_META[view] || VIEW_META['7d'];
  // Fetched log entries tagged with the bounds they belong to; `loading` is
  // derived (current bounds ≠ loaded bounds) instead of set inside the effect.
  const [loaded, setLoaded] = useState({ key: '', entries: [] });
  const [detailRow, setDetailRow] = useState(null);

  // Resolved [start, end] for the lazily-fetched strips (2w/3w only).
  const bounds = useMemo(() => {
    if (view === '7d' || view === 'calendar' || !meta.days) return null;
    return { start: addDaysLocal(today, -(meta.days - 1)), end: today };
  }, [view, meta.days, today]);

  const boundsKey = bounds ? `${bounds.start}_${bounds.end}` : '';

  useEffect(() => {
    // 7d uses pre-loaded rows; calendar self-manages.
    if (!boundsKey) return undefined;
    const [start, end] = boundsKey.split('_');
    let cancelled = false;
    fetchLogRange(start, end)
      .then(data => { if (!cancelled) setLoaded({ key: boundsKey, entries: Array.isArray(data) ? data : [] }); })
      .catch(() => { if (!cancelled) setLoaded({ key: boundsKey, entries: [] }); });
    return () => { cancelled = true; };
  }, [boundsKey]);

  const loading = !!boundsKey && loaded.key !== boundsKey;
  const extLogEntries = useMemo(
    () => (loaded.key === boundsKey ? loaded.entries : []),
    [loaded, boundsKey]
  );

  const extRows = useMemo(() => {
    if (!bounds) return [];
    const dates = listLocalDatesInclusive(bounds.start, bounds.end);
    const grouped = groupByDate(extLogEntries);
    const dayList = dates.map(d => {
      const g = grouped.find(x => x.date === d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalsPayload, dayList, { todayIso: today });
  }, [bounds, extLogEntries, today, goalsPayload]);

  const isStrip = view !== 'calendar';
  const displayRows = view === '7d' ? (rows7d || []) : extRows;
  const hits = displayRows.filter(r => r.status === 'hit').length;
  const withTargets = displayRows.filter(r => r.status !== 'no_target').length;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {/* ── Header: title + configured view label ── */}
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

        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {meta.label}
          {' · '}
          <Link to="/plan/adherence" style={{ color: 'var(--color-link)' }} title="Open the full adherence explorer — all ranges, plus this card's setting">
            Open adherence →
          </Link>
        </p>
      </div>

      {loading && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>Loading…</p>
      )}

      {/* ── Strip view: 7d / 2w / 3w ── */}
      {isStrip && !loading && (
        displayRows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
            No goal data yet — set goals to start tracking adherence.
          </p>
        ) : (
          <>
            {/* 7-column grid: rows wrap as needed for the range length.
                Keyed by view so a settings change remounts the tiles and
                replays their staggered entrance. */}
            <div key={view} style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 6,
            }}>
              {displayRows.map((row, i) => (
                <AdherenceDayTile key={row.date} row={row} onOpen={setDetailRow} delay={Math.min(i, 13) * 22} />
              ))}
            </div>

            {/* Legend */}
            <div className="panel-in" style={{ display: 'flex', gap: 14, marginTop: 12 }}>
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
        )
      )}

      {/* ── Calendar view: navigable month grid ── */}
      {view === 'calendar' && !loading && (
        <div className="panel-in">
          <AdherenceCalendarMonth macroUnits={macroUnits} bare />
        </div>
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
