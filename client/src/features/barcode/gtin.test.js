import { describe, it, expect } from 'vitest';
import { isValidGtin, digitsOnly } from './gtin';

describe('digitsOnly', () => {
  it('strips everything that is not a digit', () => {
    expect(digitsOnly(' 301-762 0422003 ')).toBe('3017620422003');
    expect(digitsOnly(null)).toBe('');
  });
});

describe('isValidGtin', () => {
  it('accepts real product barcodes', () => {
    expect(isValidGtin('3017620422003')).toBe(true); // EAN-13 (Nutella)
    expect(isValidGtin('038000138416')).toBe(true); // UPC-A (Pringles)
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
  });

  it('rejects a wrong check digit — the usual misread', () => {
    expect(isValidGtin('3017620422004')).toBe(false);
    expect(isValidGtin('038000138417')).toBe(false);
  });

  it('rejects lengths that are not a GTIN', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('1234567890')).toBe(false); // 10 digits
    expect(isValidGtin('')).toBe(false);
    expect(isValidGtin(undefined)).toBe(false);
  });

  it('ignores surrounding whitespace and separators', () => {
    expect(isValidGtin(' 3017620422003 ')).toBe(true);
    expect(isValidGtin('3-017620-422003')).toBe(true);
  });
});
