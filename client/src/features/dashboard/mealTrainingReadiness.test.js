import { describe, expect, it } from 'vitest';
import { computeMealTrainingReadiness, TRAINING_CONTEXT_LABELS } from './mealTrainingReadiness';

describe('computeMealTrainingReadiness', () => {
  it('returns minimal result for rest day', () => {
    const r = computeMealTrainingReadiness({
      calories: 600,
      protein_g: 40,
      carbs_g: 50,
      fat_g: 20,
      contextType: 'rest',
      bodyWeightKg: 75,
    });
    expect(r.isRest).toBe(true);
    expect(r.windows).toBeNull();
    expect(r.summary).toMatch(/Rest day/i);
  });

  it('scores higher-carb lower-fat meal better in early window on heavy day', () => {
    const good = computeMealTrainingReadiness({
      calories: 520,
      protein_g: 30,
      carbs_g: 75,
      fat_g: 8,
      fiber_g: 3,
      contextType: 'heavy_lifting',
      bodyWeightKg: 80,
    });
    const bad = computeMealTrainingReadiness({
      calories: 900,
      protein_g: 40,
      carbs_g: 30,
      fat_g: 55,
      fiber_g: 2,
      contextType: 'heavy_lifting',
      bodyWeightKg: 80,
    });
    const gEarly = good.windows.find(w => w.id === '15-45');
    const bEarly = bad.windows.find(w => w.id === '15-45');
    expect(gEarly.score).toBeGreaterThan(bEarly.score);
  });

  it('includes context label', () => {
    const r = computeMealTrainingReadiness({
      calories: 500,
      protein_g: 25,
      carbs_g: 60,
      fat_g: 12,
      contextType: 'medium',
      bodyWeightKg: 70,
    });
    expect(r.contextLabel).toBe(TRAINING_CONTEXT_LABELS.medium);
    expect(r.windows).toHaveLength(3);
  });
});
