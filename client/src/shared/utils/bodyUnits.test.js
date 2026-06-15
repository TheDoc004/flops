import { describe, it, expect } from 'vitest';
import {
  CM_PER_INCH,
  LB_PER_KG,
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
} from './bodyUnits';

describe('height cm ↔ ft/in', () => {
  it('converts 180 cm to about 5 ft 11 in', () => {
    const { feet, inches } = cmToFeetInches(180);
    expect(Number(feet)).toBe(5);
    expect(Number(inches)).toBeGreaterThan(10.5);
    const back = feetInchesToCm(feet, inches);
    expect(back).toBeCloseTo(180, 1);
  });

  it('roundtrips 72 in total height', () => {
    const cm = feetInchesToCm('6', '0');
    expect(cm).toBeCloseTo(6 * 12 * CM_PER_INCH, 4);
    const { feet, inches } = cmToFeetInches(cm);
    expect(feet).toBe('6');
    expect(Number(inches)).toBeCloseTo(0, 1);
  });
});

describe('weight kg ↔ lb', () => {
  it('uses 2.20462 lb per kg', () => {
    expect(kgToLb(1)).toBeCloseTo(LB_PER_KG, 4);
    expect(lbToKg(LB_PER_KG)).toBeCloseTo(1, 4);
  });
});
