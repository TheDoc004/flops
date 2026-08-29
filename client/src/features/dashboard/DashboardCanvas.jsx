import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import { layoutToRgl, mobileStackOrder, rglToLayout } from './dashboardLayout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(Responsive);

/**
 * Free-form dashboard card canvas (desktop) with mobile stack fallback.
 */
export default function DashboardCanvas({
  layout,
  editMode,
  onLayoutChange,
  cards,
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const rglLayout = useMemo(() => layoutToRgl(layout), [layout]);
  const order = mobileStackOrder(layout);

  // View mode: natural-height stack so cards grow with content (no inner scroll).
  if (!editMode) {
    return (
      <div className="dashboard-stack">
        {order.map(id => (
          <div key={id} className="dashboard-card">
            {cards[id]}
          </div>
        ))}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="dashboard-stack">
        {order.map(id => (
          <div key={id} className="dashboard-card dashboard-card--edit">
            {cards[id]}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-canvas dashboard-canvas--edit">
      <Grid
        className="layout"
        layouts={{ lg: rglLayout }}
        breakpoints={{ lg: 768 }}
        cols={{ lg: 12 }}
        rowHeight={42}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={editMode}
        isResizable={editMode}
        compactType={null}
        preventCollision
        onLayoutChange={(current) => {
          if (!editMode) return;
          onLayoutChange?.(rglToLayout(layout, current));
        }}
      >
        {rglLayout.map(item => (
          <div key={item.i} className="dashboard-card dashboard-card--edit">
            {cards[item.i]}
          </div>
        ))}
      </Grid>
    </div>
  );
}
