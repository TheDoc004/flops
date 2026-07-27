import { describe, it, expect } from 'vitest';
import { pluralizeUnit, formatAmountWithUnit } from './servingBasis';

describe('pluralizeUnit', () => {
  it('pluralizes countable units above one', () => {
    expect(pluralizeUnit('egg', 3)).toBe('eggs');
    expect(pluralizeUnit('slice', 2)).toBe('slices');
    expect(pluralizeUnit('spray', 5)).toBe('sprays');
    expect(pluralizeUnit('cup', 2)).toBe('cups');
  });

  it('leaves a single item singular', () => {
    expect(pluralizeUnit('egg', 1)).toBe('egg');
    expect(pluralizeUnit('slice', 1)).toBe('slice');
  });

  it('never pluralizes measurement abbreviations', () => {
    expect(pluralizeUnit('g', 170)).toBe('g');
    expect(pluralizeUnit('oz', 4)).toBe('oz');
    expect(pluralizeUnit('tbsp', 2)).toBe('tbsp');
    expect(pluralizeUnit('ml', 240)).toBe('ml');
  });

  it('handles awkward endings', () => {
    expect(pluralizeUnit('dash', 2)).toBe('dashes');
    expect(pluralizeUnit('patty', 2)).toBe('patties');
    expect(pluralizeUnit('box', 3)).toBe('boxes');
  });

  it('leaves units that are already plural alone', () => {
    // The AI logger stores some units pre-pluralized.
    expect(pluralizeUnit('sprays', 3)).toBe('sprays');
    expect(pluralizeUnit('slices', 2)).toBe('slices');
    expect(pluralizeUnit('pieces', 4)).toBe('pieces');
  });

  it('survives empty or missing units', () => {
    expect(pluralizeUnit('', 3)).toBe('');
    expect(pluralizeUnit(undefined, 3)).toBe('');
  });
});

describe('formatAmountWithUnit', () => {
  it('reads naturally for counted ingredients', () => {
    expect(formatAmountWithUnit(3, 'egg')).toBe('3 eggs');
    expect(formatAmountWithUnit(1, 'spray')).toBe('1 spray');
    expect(formatAmountWithUnit(3, 'slice')).toBe('3 slices');
  });

  it('leaves weights alone', () => {
    expect(formatAmountWithUnit(170, 'g')).toBe('170 g');
    expect(formatAmountWithUnit(1.5, 'oz')).toBe('1.5 oz');
  });

  it('trims float noise to two decimals', () => {
    expect(formatAmountWithUnit(28.349523125, 'g')).toBe('28.35 g');
    expect(formatAmountWithUnit(70.0, 'g')).toBe('70 g');
  });

  it('falls back when the amount is unusable', () => {
    expect(formatAmountWithUnit(null, 'g')).toBe('g');
    expect(formatAmountWithUnit(undefined, '')).toBe('—');
  });
});
