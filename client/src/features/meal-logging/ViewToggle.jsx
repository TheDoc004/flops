/**
 * The paired Macros | Micros toggle. Active side is filled; clicking it again
 * collapses the panel.
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
  const base = {
    fontSize: compact ? 12 : 'clamp(12px, 1vw, 13.5px)',
    padding: compact ? '4px 10px' : '6px clamp(10px, 1vw, 14px)',
    minHeight: compact ? 30 : 'clamp(32px, 2.6vw, 40px)',
    lineHeight: 1,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: 'var(--color-text-body)',
    cursor: 'pointer',
    fontWeight: 600,
    /* The fill washes in rather than snapping, so pressing the button reads as
       one continuous gesture with the panel opening beneath it. Same duration
       as the caret below — split timings made the two halves of the same
       button look like separate events. */
    transition:
      'background-color var(--dur-dropdown) var(--ease-out), border-color var(--dur-dropdown) var(--ease-out), color var(--dur-dropdown) var(--ease-out)',
  };
  /* Both states must set the SAME border property. `active` used to set the
     `borderColor` longhand while `base` set the `border` shorthand: collapsing
     made React drop the longhand, and since the shorthand's colour had already
     been consumed, border-color fell back to currentColor — leaving the button
     outlined in near-black text colour instead of returning to the grey. */
  const active = {
    background: 'var(--color-primary-ink, #312e81)',
    border: '1px solid var(--color-primary-ink, #312e81)',
    color: '#fff',
  };
  const btn = key => ({
    ...base,
    ...(view === key ? active : {}),
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });
  /* The fill alone said "selected", not "expanded". A chevron that flips up
     when its panel is open names the control for what it is — a dropdown —
     without needing the panel in view to tell. */
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
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        style={{ ...btn('macros'), borderRadius: '8px 0 0 8px', borderRight: 'none' }}
        onClick={() => setView(view === 'macros' ? null : 'macros')}
        aria-expanded={view === 'macros'}
        title={macrosTitle}
      >
        Macros{caret(view === 'macros')}
      </button>
      <button
        type="button"
        style={{ ...btn('micros'), borderRadius: '0 8px 8px 0', opacity: hasMicros ? 1 : 0.45, cursor: hasMicros ? 'pointer' : 'default' }}
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
