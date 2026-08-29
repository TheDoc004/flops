import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import { DASH_CARD_META, EDIT_GRID_ROW_HEIGHT, layoutToRgl, mobileStackOrder, rglToLayout } from './dashboardLayout';
import DashboardCardScale from './DashboardCardScale';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(Responsive);

const CORNER_HANDLES = ['nw', 'ne', 'sw', 'se'];

const GRID_PROPS = {
  margin: [12, 12],
  containerPadding: [0, 0],
  isDraggable: true,
  isResizable: true,
  compactType: 'vertical',
  resizeHandles: CORNER_HANDLES,
};

function cardEditClass(id, exitingIds, enteringIds) {
  let cls = 'dashboard-card dashboard-card--edit';
  if (exitingIds.includes(id)) cls += ' dashboard-card--exiting';
  if (enteringIds.includes(id)) cls += ' dashboard-card--entering';
  return cls;
}

function cardLabel(id) {
  return DASH_CARD_META[id]?.label || id.replace('_', ' ');
}

function EditCard({ item, exitingIds, enteringIds, cards }) {
  return (
    <div
      key={item.i}
      className={cardEditClass(item.i, exitingIds, enteringIds)}
      data-card-id={item.i}
    >
      <div className="dashboard-card__edit-chrome">
        <span className="dashboard-card__drag-handle" title="Drag to move" aria-label="Drag card">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </span>
        <span className="dashboard-card__edit-label">{cardLabel(item.i)}</span>
      </div>
      <DashboardCardScale>{cards[item.i]}</DashboardCardScale>
    </div>
  );
}

/**
 * Dashboard card canvas — natural-height stack in view mode; animated grid in edit mode.
 */
export default function DashboardCanvas({
  layout,
  editMode,
  onLayoutChange,
  cards,
  exitingIds = [],
  enteringIds = [],
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const rglLayout = useMemo(() => layoutToRgl(layout), [layout]);
  const order = mobileStackOrder(layout);

  if (!editMode) {
    return (
      <div className="dashboard-stack">
        {order.map(id => (
          <div key={id} className="dashboard-card dashboard-card--view">
            {cards[id]}
          </div>
        ))}
      </div>
    );
  }

  const onLayout = (current) => {
    onLayoutChange?.(rglToLayout(layout, current));
  };

  if (isMobile) {
    return (
      <div className="dashboard-canvas dashboard-canvas--edit dashboard-canvas--mobile-edit">
        <Grid
          className="layout"
          layouts={{ lg: rglLayout }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: 12 }}
          rowHeight={EDIT_GRID_ROW_HEIGHT}
          {...GRID_PROPS}
          onLayoutChange={onLayout}
        >
          {rglLayout.map(item => (
            <div
              key={item.i}
              className={cardEditClass(item.i, exitingIds, enteringIds)}
              data-card-id={item.i}
            >
              <div className="dashboard-card__edit-label" aria-hidden="true">
                {cardLabel(item.i)}
              </div>
              <DashboardCardScale>{cards[item.i]}</DashboardCardScale>
            </div>
          ))}
        </Grid>
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
        rowHeight={EDIT_GRID_ROW_HEIGHT}
        draggableHandle=".dashboard-card__drag-handle"
        {...GRID_PROPS}
        onLayoutChange={onLayout}
      >
        {rglLayout.map(item => (
          <EditCard
            key={item.i}
            item={item}
            exitingIds={exitingIds}
            enteringIds={enteringIds}
            cards={cards}
          />
        ))}
      </Grid>
    </div>
  );
}
