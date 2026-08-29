import { useEffect, useRef } from 'react';

const BASE_W = 360;
const BASE_H = 150;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Scales card innards to the grid cell size in layout-edit mode so content
 * grows/shrinks instead of leaving whitespace or scrolling.
 */
export default function DashboardCardScale({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const cell = root.closest('.react-grid-item');
    if (!cell) return undefined;

    const update = () => {
      const w = cell.clientWidth;
      const h = cell.clientHeight;
      const scale = clamp(Math.min(w / BASE_W, h / BASE_H), 0.5, 2.5);
      root.style.setProperty('--card-scale', String(scale));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(cell);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="dashboard-card__scale-root">
      {children}
    </div>
  );
}
