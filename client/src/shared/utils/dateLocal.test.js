import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldOfferNewDay,
  dismissNewDayOffer,
  goToCalendarToday,
  saveViewingDate,
  loadViewingDate,
  formatMealsSectionTitle,
  formatDisplayDate,
  VIEW_DATE_KEY,
  VIEW_DATE_STAY_KEY,
} from './dateLocal';

describe('notebook day-hold', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not offer a new day when viewing date equals calendar today', () => {
    expect(shouldOfferNewDay('2026-08-17', '2026-08-17')).toBe(false);
  });

  it('offers a new day when calendar has advanced past the viewing date', () => {
    expect(shouldOfferNewDay('2026-08-16', '2026-08-17')).toBe(true);
  });

  it('does not auto-flip: loadViewingDate keeps yesterday after save', () => {
    saveViewingDate('2026-08-16');
    expect(loadViewingDate()).toBe('2026-08-16');
    expect(shouldOfferNewDay(loadViewingDate(), '2026-08-17')).toBe(true);
  });

  it('stay dismisses the offer for that calendar day without changing viewing date', () => {
    dismissNewDayOffer('2026-08-16', '2026-08-17');
    expect(shouldOfferNewDay('2026-08-16', '2026-08-17')).toBe(false);
    expect(localStorage.getItem(VIEW_DATE_STAY_KEY)).toBe('2026-08-16|2026-08-17');
  });

  it('go to today updates viewing date and clears stay', () => {
    saveViewingDate('2026-08-16');
    dismissNewDayOffer('2026-08-16', '2026-08-17');
    const next = goToCalendarToday('2026-08-17');
    expect(next).toBe('2026-08-17');
    expect(localStorage.getItem(VIEW_DATE_KEY)).toBe('2026-08-17');
    expect(localStorage.getItem(VIEW_DATE_STAY_KEY)).toBeNull();
    expect(shouldOfferNewDay(next, '2026-08-17')).toBe(false);
  });
});

describe('formatDisplayDate', () => {
  it('formats as weekday, short month, day', () => {
    expect(formatDisplayDate('2026-08-19')).toBe('Wed, Aug 19');
  });

  it('includes year when the date is not this calendar year', () => {
    expect(formatDisplayDate('2025-12-31')).toBe('Wed, Dec 31, 2025');
  });
});

describe('formatMealsSectionTitle', () => {
  it('labels today, yesterday, and tomorrow relative to calendar day', () => {
    expect(formatMealsSectionTitle('2026-08-19', '2026-08-19')).toBe("Today's Meals");
    expect(formatMealsSectionTitle('2026-08-18', '2026-08-19')).toBe("Yesterday's Meals");
    expect(formatMealsSectionTitle('2026-08-20', '2026-08-19')).toBe("Tomorrow's Meals");
  });

  it('formats other same-year days as weekday + month + day', () => {
    expect(formatMealsSectionTitle('2026-08-12', '2026-08-19')).toBe('Meals · Wed, Aug 12');
  });

  it('includes year when viewing day is not the calendar year', () => {
    expect(formatMealsSectionTitle('2025-12-31', '2026-08-19')).toBe('Meals · Wed, Dec 31, 2025');
  });
});
