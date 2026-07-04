import { useEffect, useRef, useState } from 'react';

/**
 * Track whether an element has entered the viewport, via IntersectionObserver.
 * One-shot by default: once seen, it stays "in view" and the observer detaches,
 * so reveal animations never replay while scrolling back up.
 *
 * @param {object} [options]
 * @param {number} [options.threshold] - fraction of the element that must be visible
 * @param {string} [options.rootMargin] - shrinks the trigger area; the default means
 *   elements start animating once they're ~8% up from the bottom edge
 * @param {boolean} [options.once] - pass false to toggle off when leaving the viewport
 * @returns {[import('react').RefObject, boolean]} [ref, inView] — attach ref to the element
 */
export default function useInView({ threshold = 0.1, rootMargin = '0px 0px -8% 0px', once = true } = {}) {
  const ref = useRef(null);
  // No observer support (old browser / jsdom): start visible so content never hides.
  const [inView, setInView] = useState(() => typeof IntersectionObserver !== 'function');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return;
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
