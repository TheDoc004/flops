import { describe, it, expect } from 'vitest';
import { sumDayMicros, sumDayTotalMicros } from './microNutrients';

// A log entry carrying a micros_json blob (as stored on the server).
const entry = (micros, { confidence = 'medium', servings = 1 } = {}) => ({
  servings,
  micros_json: JSON.stringify({ micros, confidence, version: 'v1' }),
});

describe('sumDayTotalMicros — meals + supplements', () => {
  it('adds taken-supplement micros on top of meal micros', () => {
    const entries = [entry({ iron_mg: 5, vitamin_c_mg: 20 })];
    const supplements = [{ micros: { iron_mg: 8, vitamin_d_mcg: 25 } }];
    const r = sumDayTotalMicros({ entries, supplements });
    expect(r.values.iron_mg).toBe(13);       // 5 (food) + 8 (supp)
    expect(r.values.vitamin_c_mg).toBe(20);   // food only
    expect(r.values.vitamin_d_mcg).toBe(25);  // supplement only
    expect(r.supplementCount).toBe(1);
    expect(r.hasMicros).toBe(true);
  });

  it('supplements alone produce high-confidence micros when there are no meal estimates', () => {
    const r = sumDayTotalMicros({ entries: [], supplements: [{ micros: { vitamin_d_mcg: 25 } }] });
    expect(r.values.vitamin_d_mcg).toBe(25);
    expect(r.confidence).toBe('high');
    expect(r.hasMicros).toBe(true);
    expect(r.supplementCount).toBe(1);
  });

  it('does not raise the confidence set by food estimates', () => {
    const entries = [entry({ iron_mg: 5 }, { confidence: 'low' })];
    const r = sumDayTotalMicros({ entries, supplements: [{ micros: { iron_mg: 8 } }] });
    expect(r.confidence).toBe('low'); // supplements are exact but food stays low
  });

  it('a supplement with no micros contributes nothing and is not counted', () => {
    const entries = [entry({ iron_mg: 5 })];
    const r = sumDayTotalMicros({ entries, supplements: [{ micros: null }, { name: 'Creatine' }] });
    expect(r.values.iron_mg).toBe(5);
    expect(r.supplementCount).toBe(0);
  });

  it('matches sumDayMicros when there are no supplements', () => {
    const entries = [entry({ iron_mg: 5, zinc_mg: 3 })];
    const base = sumDayMicros(entries);
    const total = sumDayTotalMicros({ entries, supplements: [] });
    expect(total.values).toEqual(base.values);
    expect(total.supplementCount).toBe(0);
  });

  it('is safe on empty / missing input', () => {
    const r = sumDayTotalMicros({});
    expect(r.hasMicros).toBe(false);
    expect(r.values).toEqual({});
    expect(r.supplementCount).toBe(0);
  });
});
