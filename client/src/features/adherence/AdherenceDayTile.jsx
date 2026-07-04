import { ISO_WEEKDAY_LABELS } from '@shared/utils/weekday';
import { STATUS_META } from './statusMeta';

/**
 * Clickable status tile for one day in an adherence strip. Shared by the
 * dashboard adherence card and the full Adherence page.
 */
export default function AdherenceDayTile({ row, onOpen, delay = 0 }) {
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
      /* cal-day: hover lift/shadow + focus ring; panel-in + delay: staggered
         entrance when the strip mounts */
      className="cal-day panel-in"
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
        animationDelay: `${delay}ms`,
      }}
    >
      <span style={{ lineHeight: 1.2 }}>{wd.slice(0, 3)}</span>
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{short}</span>
    </div>
  );
}
