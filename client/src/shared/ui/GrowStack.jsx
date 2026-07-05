import { Children, useRef, useState } from 'react';
import GrowReveal from './GrowReveal';

// Per-row stagger for the page-flip slide, capped so long pages don't drag.
const SLIDE_STAGGER = 45;
const SLIDE_STAGGER_CAP = 8;

/**
 * Growing list with two entrances:
 *
 *  - The FIRST batch of rows (the initial page view) plays the grow cascade:
 *    each row expands from height 0 when it scrolls into view and the row
 *    above it has opened, so the card grows downward with its content.
 *
 *  - Rows mounted later — pagination flips, new search matches — arrive at
 *    full height and slide in sideways like turning a page, staggered
 *    top→bottom. Height never changes, so the view doesn't jump and
 *    Next/Previous can be clicked rapidly. `slideFrom` sets the direction
 *    (pass 'right' for Next, 'left' for Previous).
 *
 * Children must have stable keys (e.g. from a .map over records).
 */
export default function GrowStack({ slideFrom = 'right', children }) {
  const items = Children.toArray(children);

  // The animated cohort: keys present at the first non-empty render (data
  // usually arrives after a fetch, so "first non-empty", not "first").
  const cohortRef = useRef(null);
  if (cohortRef.current === null && items.length > 0) {
    cohortRef.current = new Set(items.map(c => c.key));
  }
  const cohort = cohortRef.current;
  const slideEntrance = slideFrom === 'left' ? 'slide-left' : 'slide-right';

  const [opened, setOpened] = useState(() => new Set());
  const markOpened = key =>
    setOpened(prev => (prev.has(key) ? prev : new Set(prev).add(key)));

  return items.map((child, idx) => (
    <GrowReveal
      key={child.key}
      entrance={cohort?.has(child.key) && !opened.has(child.key) ? 'grow' : slideEntrance}
      delay={Math.min(idx, SLIDE_STAGGER_CAP) * SLIDE_STAGGER}
      enabled={idx === 0 || opened.has(items[idx - 1].key)}
      onOpened={() => markOpened(child.key)}
    >
      {child}
    </GrowReveal>
  ));
}
