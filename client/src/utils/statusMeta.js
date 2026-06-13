/**
 * Shared adherence status metadata — single source of truth for the colors and
 * labels used by the calendar, the 7-day strip, the panel table, and the day
 * detail dialog. Colors reference the design-system status tokens (index.css).
 *
 * Shape: { label, bg, border, color } per status. Consumers use whichever
 * fields they need (e.g. the calendar ignores `label`; the dialog ignores
 * `border`). Status keys: hit | partial | miss | upcoming | no_data | no_target.
 */
export const STATUS_META = {
  hit:       { label: 'Hit',        bg: 'var(--status-hit-bg)',      border: 'var(--status-hit-border)',      color: 'var(--status-hit-text)' },
  partial:   { label: 'Partial',    bg: 'var(--status-partial-bg)',  border: 'var(--status-partial-border)',  color: 'var(--status-partial-text)' },
  miss:      { label: 'Miss',       bg: 'var(--status-miss-bg)',     border: 'var(--status-miss-border)',     color: 'var(--status-miss-text)' },
  upcoming:  { label: 'Upcoming',   bg: 'var(--status-upcoming-bg)', border: 'var(--status-upcoming-border)', color: 'var(--status-upcoming-text)' },
  no_data:   { label: 'Not logged', bg: 'var(--status-none-bg)',     border: 'var(--status-none-border)',     color: 'var(--status-none-text)' },
  no_target: { label: 'No target',  bg: 'var(--status-none-bg)',     border: 'var(--status-none-border)',     color: 'var(--status-none-text)' },
};
