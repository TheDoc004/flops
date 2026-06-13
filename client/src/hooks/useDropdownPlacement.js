import { useEffect, useState } from 'react';

const GAP = 6;   // gap between trigger and menu
const EDGE = 8;  // keep the menu off the viewport edge

/**
 * Decides whether a combobox menu should open downward or flip up, and how tall
 * it may be, so it always fits within the viewport — works the same inside
 * cards, modals, and scroll containers. Recomputes while open on scroll/resize.
 *
 * @param {React.RefObject<HTMLElement>} triggerRef - the input/trigger element
 * @param {boolean} open
 * @param {number} [desiredMaxHeight=280]
 * @returns {{ openUp: boolean, maxHeight: number }}
 */
export default function useDropdownPlacement(triggerRef, open, desiredMaxHeight = 280) {
  const [placement, setPlacement] = useState({ openUp: false, maxHeight: desiredMaxHeight });

  useEffect(() => {
    if (!open) return undefined;

    function recompute() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = vh - rect.bottom - GAP - EDGE;
      const spaceAbove = rect.top - GAP - EDGE;
      // Flip up only when there's clearly not enough room below and more room above.
      const openUp = spaceBelow < Math.min(desiredMaxHeight, 200) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(140, Math.min(desiredMaxHeight, openUp ? spaceAbove : spaceBelow));
      setPlacement({ openUp, maxHeight });
    }

    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true); // capture: catch scroll containers too
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, triggerRef, desiredMaxHeight]);

  return placement;
}
