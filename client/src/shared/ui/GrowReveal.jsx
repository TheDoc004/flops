import { useEffect, useRef, useState } from 'react';
import useInView from '@shared/hooks/useInView';

// Pause before the next sibling may start opening (see GrowStack). Tuned
// against --grow-dur in index.css: long enough that each row's expansion is
// clearly underway before the next begins, short enough to never feel slow.
const CHAIN_DELAY = 110;

/**
 * A list row with two entrance modes (see `.grow-reveal` in index.css):
 *
 *  - 'grow' (default): starts height-collapsed and expands open (0 → auto)
 *    when it scrolls into view AND `enabled` is true. Once open it latches —
 *    it never re-collapses. Because a hidden row takes up (almost) no space,
 *    the containing card physically grows with its content.
 *
 *  - 'slide-right' / 'slide-left': mounts at full height immediately (the
 *    card's height must not jump on pagination) and slides in sideways, like
 *    turning a page. `delay` staggers siblings.
 *
 * @param {boolean} [enabled] - gate from GrowStack: the previous sibling has opened
 * @param {'grow'|'slide-right'|'slide-left'} [entrance]
 * @param {number} [delay] - slide modes only: ms before the slide starts
 * @param {Function} [onOpened] - called after this row opens (CHAIN_DELAY ms
 *   after the expansion starts; immediately for slide modes)
 */
export default function GrowReveal({ enabled = true, entrance = 'grow', delay = 0, onOpened, children }) {
  // Entrance is locked at mount: once a row starts growing it must not switch
  // to the slide entrance mid-animation (GrowStack recomputes entrance as rows
  // report opened — relevant only for rows mounted AFTER that, e.g. when
  // pagination returns to a page whose rows already played the grow cascade).
  const entranceRef = useRef(entrance);
  const slide = entranceRef.current !== 'grow';
  // Live tracking (once: false): a collapsed row sits at the bottom edge of the
  // grown content, so as rows above it expand it may get pushed back out of the
  // viewport — inView must reflect where it is NOW, not where it was at mount.
  const [ref, inView] = useInView({ once: false });
  // Slide rows render .is-open from their first paint: the height transition
  // never runs (no class change) and the slide keyframes play on mount.
  const [opened, setOpened] = useState(slide);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  useEffect(() => {
    if (enabled && inView && !opened) setOpened(true);
  }, [enabled, inView, opened]);

  useEffect(() => {
    if (!opened) return;
    if (slide) {
      onOpenedRef.current?.();
      return;
    }
    const t = setTimeout(() => onOpenedRef.current?.(), CHAIN_DELAY);
    return () => clearTimeout(t);
  }, [opened, slide]);

  const cls = ['grow-reveal', opened && 'is-open', slide && entranceRef.current].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cls} style={slide && delay ? { '--slide-delay': `${delay}ms` } : undefined}>
      <div className="grow-reveal__inner">{children}</div>
    </div>
  );
}
