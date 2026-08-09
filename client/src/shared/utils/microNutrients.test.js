import { describe, it, expect } from 'vitest';
import { sumDayMicros, sumDayTotalMicros, dominantNutrients } from './microNutrients';

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

describe('dominantNutrients', () => {
  /* Targets used below: vitamin A 900mcg, iron 8mg, zinc 11mg, selenium 55mcg,
     vitamin C 90mg, calcium 1300mg, magnesium 420mg, sodium 2300mg (limit). */

  it('lists only the nutrient a food is actually carried by', () => {
    const { shown, hidden } = dominantNutrients({ vitamin_a_mcg: 450, iron_mg: 0.5 });
    expect(shown.map(r => r.key)).toEqual(['vitamin_a_mcg']);
    expect(hidden.map(r => r.key)).toEqual(['iron_mg']);
  });

  /* The point of a relative cut: three comparable leaders all belong. */
  it('keeps every nutrient in a tight leading cluster', () => {
    const { shown } = dominantNutrients({ iron_mg: 4, zinc_mg: 5.5, vitamin_c_mg: 45 });
    expect(shown.map(r => r.key).sort()).toEqual(['iron_mg', 'vitamin_c_mg', 'zinc_mg']);
  });

  it('grows the list when the food spreads across more nutrients', () => {
    const { shown, hidden } = dominantNutrients({
      iron_mg: 4, zinc_mg: 5.5, vitamin_c_mg: 45, calcium_mg: 650, magnesium_mg: 210,
    });
    expect(shown).toHaveLength(5);
    expect(hidden).toHaveLength(0);
  });

  /* A far-and-away leader should not drag its distant followers along. */
  it('drops nutrients far below the leader even when they clear the trace floor', () => {
    const { shown, hidden } = dominantNutrients({ vitamin_a_mcg: 900, iron_mg: 1.2 });
    expect(shown.map(r => r.key)).toEqual(['vitamin_a_mcg']); // iron is 15% vs a 100% leader
    expect(hidden.map(r => r.key)).toEqual(['iron_mg']);
  });

  it('hides everything when nothing clears the trace floor', () => {
    const { shown, hidden } = dominantNutrients({ iron_mg: 0.5, zinc_mg: 0.4 });
    expect(shown).toEqual([]);
    expect(hidden).toHaveLength(2);
  });

  it('caps a flat profile and hands the rest back as hidden', () => {
    const { shown, hidden } = dominantNutrients({
      iron_mg: 4, zinc_mg: 5.5, vitamin_c_mg: 45, calcium_mg: 650, magnesium_mg: 210,
      selenium_mcg: 27, vitamin_a_mcg: 450,
    });
    expect(shown).toHaveLength(6);
    expect(hidden).toHaveLength(1);
  });

  it('ranks by share of target, not by raw amount', () => {
    // 600 mg calcium is 46% of its target; 5 mg iron is 63% of a much smaller one.
    const { shown } = dominantNutrients({ calcium_mg: 600, iron_mg: 5 });
    expect(shown[0].key).toBe('iron_mg');
  });

  it('measures watch nutrients against their limit', () => {
    const { shown } = dominantNutrients({ sodium_mg: 1150 });
    expect(shown[0]).toMatchObject({ key: 'sodium_mg', share: 0.5 });
  });

  it('is safe on empty or missing input', () => {
    expect(dominantNutrients(null)).toEqual({ shown: [], hidden: [] });
    expect(dominantNutrients({})).toEqual({ shown: [], hidden: [] });
  });
});
