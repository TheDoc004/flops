import { useMemo } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import { DASH_CARD_META, EDIT_GRID_ROW_HEIGHT, layoutToRgl, mobileStackOrder, rglToLayout } from './dashboardLayout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(GridLayout);

const CORNER_HANDLES = ['nw', 'ne', 'sw', 'se'];

const GRID_PROPS = {
  cols: 12,
  margin: [12, 12],
  containerPadding: [0, 0],
  isDraggable: true,
  isResizable: true,
  compactType: 'vertical',
  resizeHandles: CORNER_HANDLES,
  draggableCancel:
    'input, textarea, button, select, option, a, .supp-chip__toggle, .stepper-btn, .log-entry-row button',
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

function EditCardChrome({ cardId }) {
  return (
    <div className="dashboard-card__edit-chrome">
      <span className="dashboard-card__drag-handle" title="Drag to move" aria-label="Drag card">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </span>
      <span className="dashboard-card__edit-label">{cardLabel(cardId)}</span>
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

  const gridItems = rglLayout.map(item => (
    <div
      key={item.i}
      data-grid={item}
      className={cardEditClass(item.i, exitingIds, enteringIds)}
      data-card-id={item.i}
    >
      <EditCardChrome cardId={item.i} />
      <div className="dashboard-card__content">{cards[item.i]}</div>
    </div>
  ));

  return (
    <div className={`dashboard-canvas dashboard-canvas--edit${isMobile ? ' dashboard-canvas--mobile-edit' : ''}`}>
      <Grid
        className="layout"
        layout={rglLayout}
        rowHeight={EDIT_GRID_ROW_HEIGHT}
        draggableHandle=".dashboard-card__drag-handle"
        onLayoutChange={onLayout}
        {...GRID_PROPS}
      >
        {gridItems}
      </Grid>
    </div>
  );
}
