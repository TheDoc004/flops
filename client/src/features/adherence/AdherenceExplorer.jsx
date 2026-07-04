import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLogRange } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchProfile, saveProfile } from '@shared/api/profile';
import { groupByDate } from '@shared/utils/macros';
import { addDaysLocal, getLocalDateISO } from '@shared/utils/dateLocal';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { buildWeeklyAdherenceRows, listLocalDatesInclusive } from './goalAdherence';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';
import AdherenceDayTile from './AdherenceDayTile';
import { STATUS_META } from './statusMeta';

const MAX_CUSTOM_DAYS = 92;

// No Calendar tab here: the explorer lives on the History page, where the
// month calendar already sits right above it.
const RANGES = [
  { key: '7d',     label: '7 days', days: 7 },
  { key: '2w',     label: '2 wks',  days: 14 },
  { key: '3w',     label: '3 wks',  days: 21 },
  { key: 'custom', label: 'Custom', days: null },
];

// Views the dashboard card can be pinned to (Custom needs inputs, so it stays
// an explorer-only range). Mirrors the same setting on the Profile page.
const DASH_VIEWS = [
  { value: '7d',       label: 'Last 7 days' },
  { value: '2w',       label: 'Last 2 weeks' },
  { value: '3w',       label: 'Last 3 weeks' },
  { value: 'calendar', label: 'Month calendar' },
];

function daysBetweenInclusive(startIso, endIso) {
  const [ay, am, ad] = startIso.split('-').map(Number);
  const [by, bm, bd] = endIso.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Goal adherence explorer — the single home of the adherence tool, embedded
 * on the History page directly beneath the adherence calendar (same card, via
 * `noCard`). Every strip range including Custom, plus the "what the dashboard
 * card shows" setting (also mirrored in Profile).
 */
export default function AdherenceExplorer({ noCard = false }) {
  const { macroUnits } = useMacroUnits();
  const today = useMemo(() => getLocalDateISO(), []);

  const [range, setRange] = useState('7d');
  const [goalsPayload, setGoalsPayload] = useState(null);
  // Fetched log entries tagged with the bounds they belong to; `loading` is
  // derived (current bounds ≠ loaded bounds) instead of set inside the effect.
  const [loaded, setLoaded] = useState({ key: '', entries: [] });
  const [detailRow, setDetailRow] = useState(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // "Show on dashboard" — mirrors Profile's dash_adherence_view setting.
  const [dashView, setDashView] = useState('7d');
  const [dashViewSaved, setDashViewSaved] = useState(false);
  const [dashViewError, setDashViewError] = useState('');
  const dashInteracted = useRef(false);

  // Goals + current dashboard setting, once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [goalsResult, profileResult] = await Promise.allSettled([
        fetchGoals({ date: today }),
        fetchProfile(),
      ]);
      if (cancelled) return;
      if (goalsResult.status === 'fulfilled' && goalsResult.value?.goals?.length) {
        setGoalsPayload(goalsResult.value);
      }
      if (profileResult.status === 'fulfilled') {
        const v = profileResult.value?.dash_adherence_view;
        if (DASH_VIEWS.some(o => o.value === v)) setDashView(v);
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  // Auto-save the dashboard view when the user changes it (guard skips the
  // initial load). Same pattern as the Profile page's dashboard prefs.
  useEffect(() => {
    if (!dashInteracted.current) return;
    let cancelled = false;
    setDashViewError('');
    setDashViewSaved(false);
    saveProfile({ dash_adherence_view: dashView })
      .then(() => {
        if (!cancelled) {
          setDashViewSaved(true);
          setTimeout(() => { if (!cancelled) setDashViewSaved(false); }, 2000);
        }
      })
      .catch(err => { if (!cancelled) setDashViewError(err.message); });
    return () => { cancelled = true; };
  }, [dashView]);

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
    if (!opt?.days) return null;
    return { start: addDaysLocal(today, -(opt.days - 1)), end: today };
  }, [range, customStart, customEnd, today]);

  const boundsKey = bounds ? `${bounds.start}_${bounds.end}` : '';

  useEffect(() => {
    if (!boundsKey) return undefined;
    const [start, end] = boundsKey.split('_');
    let cancelled = false;
    fetchLogRange(start, end)
      .then(data => { if (!cancelled) setLoaded({ key: boundsKey, entries: Array.isArray(data) ? data : [] }); })
      .catch(() => { if (!cancelled) setLoaded({ key: boundsKey, entries: [] }); });
    return () => { cancelled = true; };
  }, [boundsKey]);

  const loading = !!boundsKey && loaded.key !== boundsKey;
  const logEntries = useMemo(
    () => (loaded.key === boundsKey ? loaded.entries : []),
    [loaded, boundsKey]
  );

  const displayRows = useMemo(() => {
    if (!bounds) return [];
    const dates = listLocalDatesInclusive(bounds.start, bounds.end);
    const grouped = groupByDate(logEntries);
    const dayList = dates.map(d => {
      const g = grouped.find(x => x.date === d);
      return g
        ? { ...g, hasData: true }
        : { date: d, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, hasData: false };
    });
    return buildWeeklyAdherenceRows(goalsPayload, dayList, { todayIso: today });
  }, [bounds, logEntries, today, goalsPayload]);

  const hits = displayRows.filter(r => r.status === 'hit').length;
  const withTargets = displayRows.filter(r => r.status !== 'no_target').length;

  const inner = (
    <>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 14, gap: 8, flexWrap: 'wrap',
      }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Adherence over time</h2>
          {withTargets > 0 && !loading ? (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-text-strong)' }}>{hits}</strong>/{displayRows.length} days on target
            </p>
          ) : (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              How your logged days measure up against your macro goals.
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
        <div className="panel-in" style={{ marginBottom: 14 }}>
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

      {!loading && (
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
          ) : (
            <>
              {/* 7-column grid: rows wrap as needed for the range length.
                  Keyed by range so switching tabs replays the tile stagger. */}
              <div key={range} style={{
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
          )}
        </>
      )}

      {/* ── Dashboard pin: which view the dashboard card shows ── */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-divider-warm)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="adh-dash-view" style={{ margin: 0, whiteSpace: 'nowrap' }}>Show on dashboard</label>
          <select
            id="adh-dash-view"
            value={dashView}
            onChange={e => {
              dashInteracted.current = true;
              setDashView(e.target.value);
            }}
            style={{ width: 'auto', minWidth: 170 }}
          >
            {DASH_VIEWS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {dashViewSaved && (
            <span style={{ fontSize: 12, color: 'var(--color-success)' }}>Saved.</span>
          )}
        </div>
        {dashViewError && <p className="error" style={{ marginTop: 8 }}>{dashViewError}</p>}
      </div>

      {/* Day detail dialog */}
      {detailRow && (
        <GoalAdherenceDayDetailDialog
          key={detailRow.date}
          row={detailRow}
          macroUnits={macroUnits}
          onClose={() => setDetailRow(null)}
        />
      )}
    </>
  );

  if (noCard) return inner;
  return <div className="card">{inner}</div>;
}
