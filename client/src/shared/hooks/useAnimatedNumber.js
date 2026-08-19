import { useEffect, useRef, useState } from 'react';
import useMediaQuery from './useMediaQuery';

const DEFAULT_DURATION = 500;
const TINY_JUMP = 0.05;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * Tween a numeric display value toward `value` (count up / count down).
 * Skips the tween when the jump is tiny or the user prefers reduced motion.
 */
export default function useAnimatedNumber(value, { duration = DEFAULT_DURATION } = {}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const numeric = Number(value) || 0;
  const [display, setDisplay] = useState(numeric);
  const displayRef = useRef(numeric);
  const rafRef = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const from = displayRef.current;

    if (reduceMotion || Math.abs(target - from) < TINY_JUMP) {
      displayRef.current = target;
      setDisplay(target);
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * easeOutCubic(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduceMotion]);

  return display;
}
