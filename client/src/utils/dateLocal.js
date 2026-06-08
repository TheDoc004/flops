/**
 * Calendar dates (YYYY-MM-DD) for meal logs must use the user's local timezone,
 * not UTC (Date.toISOString().slice(0, 10) is wrong for many local times).
 */

export function getLocalDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight calendar date (for weekday). */
export function parseLocalDateISO(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add calendar days in local time; returns YYYY-MM-DD */
export function addDaysLocal(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return getLocalDateISO(dt);
}
