const {
  linearTrendWithSe,
  confidenceLabel,
  kgToLb,
  LB_PER_KG,
} = require('../mcp/weightTrend');

describe('weightTrend OLS', () => {
  it('fits a known slope against date (not index)', () => {
    // Exactly +0.1 lb/day → +0.7 lb/week; irregular gaps
    const points = [
      { date: '2026-09-01', value: 150 },
      { date: '2026-09-03', value: 150.2 },
      { date: '2026-09-07', value: 150.6 },
      { date: '2026-09-10', value: 150.9 },
      { date: '2026-09-14', value: 151.3 },
    ];
    const t = linearTrendWithSe(points);
    expect(t).not.toBeNull();
    expect(t.n).toBe(5);
    expect(t.slopePerDay).toBeCloseTo(0.1, 5);
    expect(t.slopeSePerDay).toBeCloseTo(0, 5);
  });

  it('returns null slope SE when only 2 points', () => {
    const t = linearTrendWithSe([
      { date: '2026-09-01', value: 150 },
      { date: '2026-09-08', value: 151 },
    ]);
    expect(t.slopePerDay).toBeCloseTo(1 / 7, 5);
    expect(t.slopeSePerDay).toBeNull();
  });

  it('flags <5 weigh-ins as low confidence', () => {
    const c = confidenceLabel(4, 0.3, 0.05);
    expect(c.confidence).toBe('low');
    expect(c.reason).toMatch(/4 weigh-ins/);
  });

  it('kgToLb matches bodyUnits constant', () => {
    expect(LB_PER_KG).toBe(2.20462);
    expect(kgToLb(67.72)).toBeCloseTo(149.3, 1);
  });
});
