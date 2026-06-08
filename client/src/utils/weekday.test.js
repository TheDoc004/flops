import { describe, expect, it } from 'vitest';
import { getWeekdayLongNameFromIsoDate } from './weekday';

describe('getWeekdayLongNameFromIsoDate', () => {
  it('returns English weekday for local calendar date', () => {
    expect(getWeekdayLongNameFromIsoDate('2026-01-05')).toBe('Monday');
  });
});
