import { describe, it, expect } from 'vitest';
import {
  GRAMS_PER_OZ,
  ozToGrams,
  gramsToOz,
  parseMacroInputToGrams,
  gramsToInputValue,
  formatRemaining,
} from './macroUnits';

describe('oz ↔ g', () => {
  it('converts 1 oz to grams', () => {
    expect(ozToGrams(1)).toBeCloseTo(GRAMS_PER_OZ, 4);
  });

  it('roundtrips', () => {
    const g = 150;
    const oz = gramsToOz(g);
    expect(ozToGrams(oz)).toBeCloseTo(g, 4);
  });
});

describe('parseMacroInputToGrams', () => {
  it('parses grams in metric mode', () => {
    expect(parseMacroInputToGrams('50', 'metric')).toBe(50);
  });

  it('parses oz in US mode', () => {
    expect(parseMacroInputToGrams('1', 'us')).toBeCloseTo(GRAMS_PER_OZ, 3);
  });
});

describe('gramsToInputValue', () => {
  it('shows oz when in US mode', () => {
    const g = GRAMS_PER_OZ;
    expect(gramsToInputValue(g, 'us')).toBe('1');
  });
});

describe('formatRemaining', () => {
  it('shows left when under target', () => {
    const r = formatRemaining(100, 40, 'metric');
    expect(r.text).toMatch(/left/);
    expect(r.kind).toBe('left');
  });

  it('shows over when above target', () => {
    const r = formatRemaining(100, 120, 'metric');
    expect(r.text).toMatch(/over/);
    expect(r.kind).toBe('over');
  });
});
