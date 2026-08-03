import { describe, it, expect } from 'vitest';
import { linearTrend, trendValueOn, projectWeight, describeDirection, summarizeWeights } from './weightStats';

/** Steady 0.1/day loss from 200 on 2026-01-01, one weigh-in a day. */
function steadyLoss(days = 20) {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    value: 200 - i * 0.1,
  }));
}

describe('linearTrend', () => {
  it('recovers the slope of a clean line', () => {
    const t = linearTrend(steadyLoss(10));
    expect(t.slopePerDay).toBeCloseTo(-0.1, 6);
    expect(t.intercept).toBeCloseTo(200, 6);
    expect(t.rmse).toBeCloseTo(0, 6);
    expect(t.n).toBe(10);
  });

  it('regresses on dates, not row order, so gaps carry their weight', () => {
    // Two points a month apart. Index-based fitting would call this -1/step.
    const t = linearTrend([
      { date: '2026-01-01', value: 200 },
      { date: '2026-01-31', value: 197 },
    ]);
    expect(t.slopePerDay).toBeCloseTo(-0.1, 6);
  });

  it('is order-insensitive', () => {
    const asc = linearTrend(steadyLoss(6));
    const desc = linearTrend([...steadyLoss(6)].reverse());
    expect(desc.slopePerDay).toBeCloseTo(asc.slopePerDay, 9);
  });

  it('returns null below two points, or when every weigh-in is the same day', () => {
    expect(linearTrend([])).toBeNull();
    expect(linearTrend([{ date: '2026-01-01', value: 200 }])).toBeNull();
    expect(linearTrend([
      { date: '2026-01-01', value: 200 },
      { date: '2026-01-01', value: 201 },
    ])).toBeNull();
  });

  it('reports scatter as rmse when the points are noisy', () => {
    const clean = linearTrend(steadyLoss(8));
    const noisy = linearTrend(steadyLoss(8).map((p, i) => ({ ...p, value: p.value + (i % 2 ? 1.5 : -1.5) })));
    expect(clean.rmse).toBeLessThan(noisy.rmse);
    expect(noisy.rmse).toBeGreaterThan(1);
  });
});

describe('trendValueOn', () => {
  it('evaluates the fitted line on a date', () => {
    const t = linearTrend(steadyLoss(10));
    expect(trendValueOn(t, '2026-01-01')).toBeCloseTo(200, 6);
    expect(trendValueOn(t, '2026-01-11')).toBeCloseTo(199, 6);
  });

  it('is null without a trend', () => {
    expect(trendValueOn(null, '2026-01-01')).toBeNull();
  });
});

describe('describeDirection', () => {
  it('calls real movement, and ignores noise inside the dead band', () => {
    expect(describeDirection(-0.2)).toBe('down');
    expect(describeDirection(0.2)).toBe('up');
    expect(describeDirection(0.01)).toBe('flat');
    expect(describeDirection(-0.01)).toBe('flat');
  });
});

describe('projectWeight', () => {
  it('extends a clean trend a week out', () => {
    const p = projectWeight(steadyLoss(14), 7);
    expect(p.value).toBeCloseTo(200 - 13 * 0.1 - 0.7, 4);
    expect(p.change).toBeCloseTo(-0.7, 4);
    expect(p.direction).toBe('down');
    expect(p.margin).toBeCloseTo(0, 4);
  });

  it('widens the band when the log is jumpy', () => {
    const noisy = steadyLoss(14).map((p, i) => ({ ...p, value: p.value + (i % 2 ? 2 : -2) }));
    expect(projectWeight(noisy, 7).margin).toBeGreaterThan(projectWeight(steadyLoss(14), 7).margin);
  });

  it('refuses to project from too few weigh-ins', () => {
    expect(projectWeight(steadyLoss(3), 7)).toBeNull();
  });

  it('refuses to project from a span shorter than a week', () => {
    // Four weigh-ins, but all inside four days — nothing to extrapolate from.
    const clustered = [
      { date: '2026-01-01', value: 200 },
      { date: '2026-01-02', value: 199.8 },
      { date: '2026-01-03', value: 199.6 },
      { date: '2026-01-04', value: 199.4 },
    ];
    expect(projectWeight(clustered, 7)).toBeNull();
  });
});

describe('summarizeWeights', () => {
  it('summarises the window', () => {
    const s = summarizeWeights(steadyLoss(11));
    expect(s.count).toBe(11);
    expect(s.current).toBeCloseTo(199, 6);
    expect(s.currentDate).toBe('2026-01-11');
    expect(s.changeVsPrevious).toBeCloseTo(-0.1, 6);
    expect(s.changeOverRange).toBeCloseTo(-1, 6);
    expect(s.average).toBeCloseTo(199.5, 6);
    expect(s.spanDays).toBe(10);
    expect(s.perWeek).toBeCloseTo(-0.7, 6);
    expect(s.direction).toBe('down');
  });

  it('handles a lone weigh-in without inventing comparisons', () => {
    const s = summarizeWeights([{ date: '2026-01-01', value: 180 }]);
    expect(s.count).toBe(1);
    expect(s.current).toBe(180);
    expect(s.changeVsPrevious).toBeNull();
    expect(s.changeOverRange).toBeNull();
    expect(s.perWeek).toBeNull();
  });

  it('is null with nothing logged', () => {
    expect(summarizeWeights([])).toBeNull();
    expect(summarizeWeights(null)).toBeNull();
  });

  it('ignores malformed rows', () => {
    const s = summarizeWeights([
      { date: '2026-01-01', value: 180 },
      { date: '2026-01-02', value: null },
      { date: null, value: 5 },
      { date: '2026-01-03', value: 179 },
    ]);
    expect(s.count).toBe(2);
    expect(s.current).toBe(179);
  });
});
