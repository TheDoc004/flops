import styles from './ViewToggle.module.css';

/**
 * The paired Macros | Micros toggle. Active side is filled; clicking it again
 * collapses the panel. The fill is a sliding thumb so swapping sides does not
 * teleport.
 *
 * Shared by the logged-meal row (Today, Review) and the recipe row (Library) so
 * the same control means the same thing everywhere it appears.
 *
 * @param macrosTitle/microsTitle  tooltips — the recipe context describes a
 *   recipe, not a logged meal
 */
export default function ViewToggle({
  view,
  setView,
  hasMicros,
  compact = false,
  macrosTitle = 'Macro breakdown per ingredient',
  microsTitle = 'Micronutrients in this meal',
  noMicrosTitle = 'No micronutrient estimate for this meal',
}) {
  const thumbClass = view === 'macros'
    ? `${styles.thumb} ${styles.thumbMacros}`
    : view === 'micros'
      ? `${styles.thumb} ${styles.thumbMicros}`
      : `${styles.thumb} ${styles.thumbHidden}`;

  const caret = open => (
    <span
      aria-hidden="true"
      style={{
        fontSize: 9,
        lineHeight: 1,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--dur-dropdown) var(--ease-out)',
      }}
    >
      ▾
    </span>
  );

  return (
    <span className={`${styles.bar} ${compact ? styles.compact : ''}`}>
      <span className={thumbClass} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.tab} ${view === 'macros' ? styles.tabActive : ''}`}
        onClick={() => setView(view === 'macros' ? null : 'macros')}
        aria-expanded={view === 'macros'}
        title={macrosTitle}
      >
        Macros{caret(view === 'macros')}
      </button>
      <button
        type="button"
        className={`${styles.tab} ${view === 'micros' ? styles.tabActive : ''}`}
        onClick={() => hasMicros && setView(view === 'micros' ? null : 'micros')}
        aria-expanded={view === 'micros'}
        disabled={!hasMicros}
        title={hasMicros ? microsTitle : noMicrosTitle}
      >
        Micros{caret(view === 'micros')}
      </button>
    </span>
  );
}
