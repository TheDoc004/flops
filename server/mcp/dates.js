/** Shared date helpers for MCP read tools. */

function isoDateOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getLocalDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO weekday: Monday = 1 … Sunday = 7 (local calendar date). */
function isoWeekdayFromDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

function daysBetweenInclusive(start, end) {
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  return Math.floor((b - a) / 86400000) + 1;
}

function normalizeRange(startRaw, endRaw, { maxDays = 90 } = {}) {
  const start = isoDateOrNull(startRaw);
  const end = isoDateOrNull(endRaw);
  if (!start || !end) {
    return { error: 'start and end must be YYYY-MM-DD' };
  }
  const [from, to] = start <= end ? [start, end] : [end, start];
  const days = daysBetweenInclusive(from, to);
  if (days > maxDays) {
    return { error: `Date range too long (${days} days). Max is ${maxDays}.` };
  }
  return { start: from, end: to, days };
}

module.exports = {
  isoDateOrNull,
  getLocalDateISO,
  isoWeekdayFromDate,
  daysBetweenInclusive,
  normalizeRange,
};
