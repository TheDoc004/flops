import { useEffect, useRef } from 'react';

const SCALE_MIN = 0.38;
const SCALE_MAX = 1;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Scales card innards to the react-grid-layout cell in edit mode.
 * Measures natural content size, then applies a uniform transform so macros,
 * supplement chips, weight row, and charts reflow visually without overlap.
 */
export default function DashboardCardScale({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    let frame = 0;

    const update = () => {
      frame = 0;
      const cell = root.closest('.react-grid-item');
      const card = root.closest('.dashboard-card');
      if (!cell || !card) return;

      const chrome = card.querySelector('.dashboard-card__edit-chrome');
      const cs = getComputedStyle(card);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const chromeH = chrome?.offsetHeight ?? 0;
      const chromeGap = chrome
        ? parseFloat(getComputedStyle(chrome).marginBottom) || 0
        : 0;

      const availW = Math.max(0, cell.clientWidth - padX);
      const availH = Math.max(0, cell.clientHeight - chromeH - chromeGap - padY);

      root.style.transform = 'none';
      root.style.marginBottom = '0';
      root.style.width = `${availW}px`;
      root.style.height = 'auto';

      const naturalH = root.scrollHeight;
      const naturalW = availW;
      if (naturalH < 1 || naturalW < 1) return;

      const scale = clamp(
        Math.min(availW / naturalW, availH / naturalH),
        SCALE_MIN,
        SCALE_MAX,
      );

      root.style.transformOrigin = 'top center';
      root.style.transform = `scale(${scale})`;
      root.style.width = `${naturalW}px`;
      root.style.height = `${naturalH}px`;
      if (scale < 1) {
        root.style.marginBottom = `${naturalH * (scale - 1)}px`;
      }
      root.style.setProperty('--card-scale', String(scale));
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    const cell = root.closest('.react-grid-item');
    if (cell) ro.observe(cell);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className="dashboard-card__scale-root">
      {children}
    </div>
  );
}
