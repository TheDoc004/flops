import { useEffect, useRef, useState } from 'react';

/**
 * Track whether an element has entered the viewport, via IntersectionObserver.
 * One-shot by default: once seen, it stays "in view" and the observer detaches,
 * so reveal animations never replay while scrolling back up.
 *
 * @param {object} [options]
 * @param {number} [options.threshold] - fraction of the element that must be visible
 * @param {string} [options.rootMargin] - grows/shrinks the trigger area. Default
 *   is '0px' (the real viewport): a shrunk bottom edge could leave the last
 *   element in a dead zone that never intersects, hiding it permanently.
 * @param {boolean} [options.once] - pass false to toggle off when leaving the viewport
 * @returns {[import('react').RefObject, boolean]} [ref, inView] — attach ref to the element
 */
export default function useInView({ threshold = 0.1, rootMargin = '0px', once = true } = {}) {
  const ref = useRef(null);
  // No observer support (old browser / jsdom): start visible so content never hides.
  const [inView, setInView] = useState(() => typeof IntersectionObserver !== 'function');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return;

    // Safety net: if the element is already on-screen at mount, reveal it right
    // away rather than waiting on the observer. Together with rootMargin '0px'
    // (no shrunk trigger area) this guarantees visible content is never left
    // stuck at opacity 0 — the bug where the last meal row in History stayed
    // hidden — while still animating anything below the fold in on scroll.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < vh && rect.bottom > 0) {
      setInView(true);
      if (once) return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        if (once) observer.disconnect();
      } else if (!once) {
        setInView(false);
      }
    }, { threshold, rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, inView];
}
