/**
 * Least-squares weight trend (port of client weightStats.linearTrend).
 * Regresses value vs days-since-first-point — not array index — so irregular
 * weigh-ins don't skew the slope.
 */

const LB_PER_KG = 2.20462;

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  return Math.round((db - da) / MS);
}

function kgToLb(kg) {
  return Number(kg) * LB_PER_KG;
}

function sortedPoints(points) {
  return (points || [])
    .filter(p => {
      if (!p || !p.date) return false;
      if (p.value === null || p.value === undefined || p.value === '') return false;
      return Number.isFinite(Number(p.value));
    })
    .map(p => ({ date: p.date, value: Number(p.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * @param {{ date: string, value: number }[]} points
 * @returns {{ slopePerDay: number, slopeSePerDay: number, intercept: number, rmse: number, n: number, firstDate: string } | null}
 */
function linearTrendWithSe(points) {
  const pts = sortedPoints(points);
  const n = pts.length;
  if (n < 2) return null;

  const firstDate = pts[0].date;
  const xs = pts.map(p => daysBetween(firstDate, p.date));
  const ys = pts.map(p => p.value);

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;

  const slopePerDay = num / den;
  const intercept = meanY - slopePerDay * meanX;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slopePerDay * xs[i];
    sumSq += (ys[i] - fitted) ** 2;
  }
  const rmse = n > 2 ? Math.sqrt(sumSq / (n - 2)) : 0;
  // SE(β) = σ / sqrt(Σ(x−x̄)²)
  const slopeSePerDay = n > 2 && den > 0 ? rmse / Math.sqrt(den) : null;

  return { slopePerDay, slopeSePerDay, intercept, rmse, n, firstDate };
}

/**
 * Confidence for a weekly slope estimate.
 * <5 weigh-ins → low. Else use |slope|/SE (t-ish): <1 low, <2 medium, else high.
 */
function confidenceLabel(weighInCount, slopePerWeek, slopeSePerWeek) {
  if (weighInCount < 5) {
    return {
      confidence: 'low',
      reason: `Only ${weighInCount} weigh-ins (need ≥5 for a trustworthy slope).`,
    };
  }
  if (slopeSePerWeek == null || !Number.isFinite(slopeSePerWeek)) {
    return { confidence: 'low', reason: 'Could not estimate slope standard error.' };
  }
  if (slopeSePerWeek === 0) {
    return { confidence: 'high', reason: 'Points lie on a perfect line.' };
  }
  const t = Math.abs(Number(slopePerWeek) || 0) / slopeSePerWeek;
  if (t < 1) {
    return {
      confidence: 'low',
      reason: `Slope is small relative to noise (|slope|/SE ≈ ${t.toFixed(2)}).`,
    };
  }
  if (t < 2) {
    return {
      confidence: 'medium',
      reason: `|slope|/SE ≈ ${t.toFixed(2)}.`,
    };
  }
  return {
    confidence: 'high',
    reason: `|slope|/SE ≈ ${t.toFixed(2)}.`,
  };
}

function round(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

module.exports = {
  LB_PER_KG,
  daysBetween,
  kgToLb,
  sortedPoints,
  linearTrendWithSe,
  confidenceLabel,
  round,
};
