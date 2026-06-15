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
