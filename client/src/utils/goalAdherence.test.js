import { describe, expect, it } from 'vitest';
import {
  normalizeTargetRange,
  evaluateAdherence,
  buildWeeklyAdherenceRows,
  buildDayAdherenceDetail,
  resolveGoalRowForDate,
  goalsToTargets,
} from './goalAdherence';

describe('normalizeTargetRange', () => {
  it('creates an exact target when only one side is provided', () => {
    expect(normalizeTargetRange(100, null)).toEqual({ min: 100, max: 100 });
    expect(normalizeTargetRange(null, 120)).toEqual({ min: 120, max: 120 });
  });
});

describe('evaluateAdherence', () => {
  const z = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

  it('returns no_target when nothing set', () => {
    expect(evaluateAdherence(z, { calories: null, protein_g: null, carbs_g: null, fat_g: null }).status).toBe(
      'no_target'
    );
  });

  it('returns hit when all defined targets are in range', () => {
    const targets = {
      calories: { min: 2000, max: 2200 },
      protein_g: { min: 160, max: 180 },
      carbs_g: { min: 180, max: 215 },
      fat_g: { min: 65, max: 75 },
    };
    const totals = { calories: 2100, protein_g: 170, carbs_g: 200, fat_g: 70 };
    expect(evaluateAdherence(totals, targets).status).toBe('hit');
  });

  it('returns partial when some targets are in range and some are not', () => {
    const targets = {
      calories: { min: 2000, max: 2200 },
      protein_g: { min: 160, max: 180 },
      carbs_g: { min: 180, max: 215 },
      fat_g: { min: 65, max: 75 },
    };
    const totals = { calories: 2100, protein_g: 140, carbs_g: 200, fat_g: 80 };
    expect(evaluateAdherence(totals, targets).status).toBe('partial');
  });

  it('returns miss when every defined target is out of range', () => {
    const targets = {
      calories: { min: 2000, max: 2200 },
      protein_g: { min: 160, max: 180 },
      carbs_g: null,
      fat_g: null,
    };
    const totals = { calories: 1500, protein_g: 100, carbs_g: 0, fat_g: 0 };
    expect(evaluateAdherence(totals, targets).status).toBe('miss');
  });
});

describe('goal version resolution', () => {
  const goalPayload = {
    versions: [
      {
        effective_start_date: '2026-01-01',
        goals: [{ weekday: 1, calories_min: 1800, calories_max: 1900 }],
      },
      {
        effective_start_date: '2026-02-01',
        goals: [{ weekday: 1, calories_min: 2800, calories_max: 3000 }],
      },
    ],
  };

  it('resolves the goal row active for a date', () => {
    expect(resolveGoalRowForDate(goalPayload, '2026-01-12').calories_min).toBe(1800);
    expect(resolveGoalRowForDate(goalPayload, '2026-02-02').calories_min).toBe(2800);
  });
});

describe('buildWeeklyAdherenceRows', () => {
  it('maps historical goal versions to dates', () => {
    const goalPayload = {
      versions: [
        {
          effective_start_date: '2026-01-01',
          goals: [{ weekday: 1, calories_min: 100, calories_max: 100, protein_g_min: 10, protein_g_max: 10, carbs_g_min: 10, carbs_g_max: 10, fat_g_min: 10, fat_g_max: 10 }],
        },
        {
          effective_start_date: '2026-02-01',
          goals: [{ weekday: 1, calories_min: 200, calories_max: 200, protein_g_min: 20, protein_g_max: 20, carbs_g_min: 20, carbs_g_max: 20, fat_g_min: 20, fat_g_max: 20 }],
        },
      ],
    };
    const rows = buildWeeklyAdherenceRows(goalPayload, [
      { date: '2026-01-05', calories: 100, protein_g: 10, carbs_g: 10, fat_g: 10 },
      { date: '2026-02-02', calories: 200, protein_g: 20, carbs_g: 20, fat_g: 20 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('hit');
    expect(rows[0].targets.protein_g).toEqual({ min: 10, max: 10 });
    expect(rows[1].targets.protein_g).toEqual({ min: 20, max: 20 });
  });
});

describe('buildDayAdherenceDetail', () => {
  it('labels range deltas in grams when metric', () => {
    const targets = goalsToTargets({
      calories_min: 2000,
      calories_max: 2200,
      protein_g_min: 160,
      protein_g_max: 180,
      carbs_g_min: 180,
      carbs_g_max: 215,
      fat_g_min: 65,
      fat_g_max: 75,
    });
    const totals = { calories: 2100, protein_g: 140, carbs_g: 200, fat_g: 70 };
    const d = buildDayAdherenceDetail(totals, targets, 'metric');
    const p = d.categories.find(c => c.key === 'protein_g');
    expect(p.deltaLabel).toMatch(/Under by/);
    expect(p.missedTolerance).toBe(true);
  });
});
