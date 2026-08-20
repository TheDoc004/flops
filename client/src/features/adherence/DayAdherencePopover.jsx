import { buildDayAdherenceDetail } from './goalAdherence';
import { ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';

/** Roughly the popover's own size — used to keep it inside the viewport. */
const WIDTH = 250;
const EST_HEIGHT = 210;
const GAP = 8;

/**
 * What one day actually looked like against its goals, shown on hover (or a
 * long press on touch) over a calendar tile.
 *
 * Replaces the old click-to-open detail card below the grid. That card kept its
 * own snapshot of the clicked day, separate from the calendar's selection, and
 * the two drifted apart — this reads the row it's handed on every render, so
 * there is no second copy of the truth to go stale.
 *
 * @param row   a live row from the calendar's dayRows (never a stored copy)
 * @param rect  the hovered tile's bounding rect, for positioning
 */
export default function DayAdherencePopover({ row, rect, macroUnits }) {
  if (!row || !rect) return null;
  const detail = buildDayAdherenceDetail(row.totals, row.targets, macroUnits, {
    status: row.status,
    hasData: row.hasData,
  });
  if (!detail) return null;

  // Prefer above the tile; flip below when there isn't room. Clamp horizontally
  // so tiles in the Sunday/Saturday columns don't push it off-screen.
  const above = rect.top >= EST_HEIGHT + GAP;
  const top = above ? rect.top - GAP : rect.bottom + GAP;
  const rawLeft = rect.left + rect.width / 2 - WIDTH / 2;
  const left = Math.min(Math.max(GAP, rawLeft), window.innerWidth - WIDTH - GAP);

  const weekday = ISO_WEEKDAY_LABELS[row.weekday] || '';
  const noData = row.status === 'no_data' || row.status === 'upcoming' || row.hasData === false;

  return (
    <div
      role="tooltip"
      className="panel-in"
      style={{
        position: 'fixed',
        top,
        left,
        width: WIDTH,
        transform: above ? 'translateY(-100%)' : 'none',
        zIndex: 60,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-surface-border)',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        padding: '10px 12px',
        pointerEvents: 'none',
      }}
    >
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>
        {weekday}
        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {row.date}</span>
      </p>

      {noData ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
          {row.status === 'upcoming' ? 'Upcoming. Nothing logged yet.' : 'No meals logged.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {detail.categories.map(c => {
            // Green when the day landed inside the saved range, muted when it
            // didn't — the "under/over by" text carries the direction.
            const hit = c.toleranceOk === true;
            const valueColor = hit ? 'var(--status-hit-text)' : 'var(--color-text-muted)';
            return (
              <div key={c.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-body)' }}>{c.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: valueColor, fontVariantNumeric: 'tabular-nums' }}>
                    {c.actualDisplay}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 1 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    goal {c.goalDisplay}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: hit ? 600 : 400, color: valueColor }}>
                    {c.deltaLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
