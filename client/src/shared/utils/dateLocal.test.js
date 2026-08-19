import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldOfferNewDay,
  dismissNewDayOffer,
  goToCalendarToday,
  saveViewingDate,
  loadViewingDate,
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
