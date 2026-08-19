/**
 * Calendar dates (YYYY-MM-DD) for meal logs must use the user's local timezone,
 * not UTC (Date.toISOString().slice(0, 10) is wrong for many local times).
 */

export const VIEW_DATE_KEY = 'flops_view_date';
export const VIEW_DATE_STAY_KEY = 'flops_view_date_stay'; // calendar date we dismissed the banner for

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

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Load persisted viewing date, or fall back to the calendar today. */
export function loadViewingDate() {
  try {
    const raw = localStorage.getItem(VIEW_DATE_KEY);
    if (isIsoDate(raw)) return raw;
  } catch { /* storage unavailable */ }
  return getLocalDateISO();
}

export function saveViewingDate(isoDate) {
  if (!isIsoDate(isoDate)) return;
  try {
    localStorage.setItem(VIEW_DATE_KEY, isoDate);
  } catch { /* storage unavailable */ }
}

/**
 * Notebook day-hold: do not auto-advance the viewing date when the calendar
 * rolls forward. Returns whether a "new day" banner should show.
 *
 * @param {string} viewingDate currently shown notebook day
 * @param {string} [calendarToday] wall-clock local date (injectable for tests)
 */
export function shouldOfferNewDay(viewingDate, calendarToday = getLocalDateISO()) {
  if (!isIsoDate(viewingDate) || !isIsoDate(calendarToday)) return false;
  if (viewingDate >= calendarToday) return false;
  try {
    const stayed = localStorage.getItem(VIEW_DATE_STAY_KEY);
    // Dismissed for this calendar day while still on viewingDate — don't nag again today.
    if (stayed === `${viewingDate}|${calendarToday}`) return false;
  } catch { /* */ }
  return true;
}

export function dismissNewDayOffer(viewingDate, calendarToday = getLocalDateISO()) {
  try {
    localStorage.setItem(VIEW_DATE_STAY_KEY, `${viewingDate}|${calendarToday}`);
  } catch { /* */ }
}

export function goToCalendarToday(calendarToday = getLocalDateISO()) {
  saveViewingDate(calendarToday);
  try {
    localStorage.removeItem(VIEW_DATE_STAY_KEY);
  } catch { /* */ }
  return calendarToday;
}

/**
 * Dashboard meals H2 for the viewing calendar day relative to wall-clock today.
 * @param {string} viewingISO YYYY-MM-DD notebook day
 * @param {string} calendarISO YYYY-MM-DD local today
 */
export function formatMealsSectionTitle(viewingISO, calendarISO) {
  if (viewingISO === calendarISO) return "Today's Meals";
  if (viewingISO === addDaysLocal(calendarISO, -1)) return "Yesterday's Meals";
  if (viewingISO === addDaysLocal(calendarISO, 1)) return "Tomorrow's Meals";
  const d = parseLocalDateISO(viewingISO);
  const calYear = parseLocalDateISO(calendarISO).getFullYear();
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== calYear) opts.year = 'numeric';
  return `Meals · ${d.toLocaleDateString('en-US', opts)}`;
}
