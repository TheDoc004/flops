import { parseLocalDateISO } from './dateLocal';

export const ISO_WEEKDAY_LABELS = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

/** Display order for week views: Sunday-first (universal calendar convention).
    Data stays ISO (Mon=1…Sun=7) everywhere — this is presentation order only. */
export const SUNDAY_FIRST_WEEKDAYS = [7, 1, 2, 3, 4, 5, 6];

/** Column index (0..6) of an ISO weekday in a Sunday-first week grid. */
export const sundayFirstIndex = isoWeekday => isoWeekday % 7;

/** ISO weekday: Monday = 1 … Sunday = 7 (matches JS getDay() mapping below) */
export function getIsoWeekday(date = new Date()) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/** Human-readable weekday from calendar date string YYYY-MM-DD (local). */
export function getWeekdayLongNameFromIsoDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const wd = getIsoWeekday(parseLocalDateISO(isoDate));
  return ISO_WEEKDAY_LABELS[wd] || '';
}
