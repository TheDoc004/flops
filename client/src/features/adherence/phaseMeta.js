/**
 * Diet-phase kinds and their badge colors (tokens in index.css). Mirrors
 * PHASE_KINDS in server/dietPhases.js — add a kind in both places.
 */
export const PHASE_META = {
  cut:         { label: 'Cut',         color: 'var(--phase-cut)' },
  bulk:        { label: 'Bulk',        color: 'var(--phase-bulk)' },
  maintenance: { label: 'Maintenance', color: 'var(--phase-maintenance)' },
  recovery:    { label: 'Recovery',    color: 'var(--phase-recovery)' },
  other:       { label: 'Other',       color: 'var(--phase-other)' },
};

export const PHASE_KINDS = Object.keys(PHASE_META);

/**
 * Best-guess color for a typed name ("Winter bulk" → bulk), used until the
 * user picks a color themselves. Only a suggestion; 'other' when nothing fits.
 */
export function guessPhaseKind(name) {
  const n = String(name || '').toLowerCase();
  if (/\bbulk/.test(n)) return 'bulk';
  if (/\bcut|deficit|shred/.test(n)) return 'cut';
  if (/maint/.test(n)) return 'maintenance';
  if (/recover|deload|break|rest/.test(n)) return 'recovery';
  return 'other';
}

/** What the badge says: the user's own name, else the kind. */
export function phaseTitle(phase) {
  return phase?.label || PHASE_META[phase?.kind]?.label || 'Phase';
}
