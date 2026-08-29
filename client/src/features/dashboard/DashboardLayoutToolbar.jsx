import { DASH_CARD_IDS, DASH_CARD_META } from './dashboardLayout';

/**
 * In-layout card picker — add/remove cards with immediate preview (edit mode only).
 */
export default function DashboardLayoutToolbar({ layout, onToggleCard, busyId }) {
  const visible = new Set(
    (layout?.cards || []).filter(c => c.visible !== false).map(c => c.id),
  );

  return (
    <div className="dash-layout-toolbar" role="toolbar" aria-label="Dashboard cards">
      <p className="dash-layout-toolbar__hint">
        Tap a card to show or hide it. Drag handles on the canvas to move and resize.
      </p>
      <div className="dash-layout-toolbar__chips">
        {DASH_CARD_IDS.map(id => {
          const meta = DASH_CARD_META[id];
          if (!meta || meta.canHide === false) return null;
          const on = visible.has(id);
          const busy = busyId === id;
          return (
            <button
              key={id}
              type="button"
              className={`dash-layout-chip${on ? ' is-on' : ''}${busy ? ' is-busy' : ''}`}
              aria-pressed={on}
              disabled={!!busyId}
              onClick={() => onToggleCard(id, !on)}
            >
              <span className="dash-layout-chip__dot" aria-hidden="true" />
              {meta.label}
              <span className="dash-layout-chip__action">{on ? 'Hide' : 'Add'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
