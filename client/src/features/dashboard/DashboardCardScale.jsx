import { useEffect, useRef } from 'react';
import { readabilityScaleFloor } from './dashboardReadability';

const SCALE_MAX = 1;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Scales card innards to the react-grid-layout cell in edit mode.
 * Uniform transform keeps macros, chips, and meal rows proportional — no
 * internal scrollbars. Scale halts at a typography floor (12px body) and pairs
 * with grid minH/minW so resize handles stop at the same boundary.
 */
export default function DashboardCardScale({ cardId, children }) {
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

      const scaleFloor = readabilityScaleFloor(cardId, root);

      const rawScale = Math.min(availW / naturalW, availH / naturalH);
      const scale = clamp(rawScale, scaleFloor, SCALE_MAX);
      const atFloor = rawScale < scaleFloor - 0.001;

      root.style.transformOrigin = 'top center';
      root.style.transform = `scale(${scale})`;
      root.style.width = `${naturalW}px`;
      root.style.height = `${naturalH}px`;
      if (scale < 1) {
        root.style.marginBottom = `${naturalH * (scale - 1)}px`;
      }
      root.style.setProperty('--card-scale', String(scale));
      root.dataset.scaleFloor = atFloor ? '1' : '0';
      cell.dataset.scaleFloor = atFloor ? '1' : '0';
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
  }, [cardId]);

  return (
    <div ref={ref} className="dashboard-card__scale-root" data-card-scale-id={cardId}>
      {children}
    </div>
  );
}
