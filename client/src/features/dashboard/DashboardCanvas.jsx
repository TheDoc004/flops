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

  if (isMobile) {
    const order = mobileStackOrder(layout);
    return (
      <div className="dashboard-stack">
        {order.map(id => (
          <div
            key={id}
            className={editMode ? 'dashboard-card dashboard-card--edit' : 'dashboard-card'}
          >
            {cards[id]}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={editMode ? 'dashboard-canvas dashboard-canvas--edit' : 'dashboard-canvas'}>
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
          <div key={item.i} className={editMode ? 'dashboard-card dashboard-card--edit' : 'dashboard-card'}>
            {cards[item.i]}
          </div>
        ))}
      </Grid>
    </div>
  );
}
