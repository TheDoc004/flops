import { describe, expect, it } from 'vitest';
import { addDaysLocal, getLocalDateISO, parseLocalDateISO } from './dateLocal';

describe('getLocalDateISO', () => {
  it('formats local calendar date as YYYY-MM-DD', () => {
    expect(getLocalDateISO(new Date(2026, 3, 10))).toBe('2026-04-10');
  });
});

describe('parseLocalDateISO', () => {
  it('parses YYYY-MM-DD as local date', () => {
    const d = parseLocalDateISO('2026-01-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

describe('addDaysLocal', () => {
  it('adds days across month boundaries', () => {
    expect(addDaysLocal('2026-04-28', 5)).toBe('2026-05-03');
  });

  it('subtracts days across month boundaries', () => {
    expect(addDaysLocal('2026-05-03', -5)).toBe('2026-04-28');
  });
});
