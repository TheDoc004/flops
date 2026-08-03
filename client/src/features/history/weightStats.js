import { parseLocalDateISO } from '@shared/utils/dateLocal';

/**
 * Summary statistics for a run of weigh-ins.
 *
 * Everything here works in whatever unit it's handed — convert kg → lb before
 * calling, not after, so the numbers and the chart can never disagree.
 *
 * Points are `{ date: 'YYYY-MM-DD', value: number }`, any order.
 */

/** Whole days from a to b (b - a). */
function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((parseLocalDateISO(b) - parseLocalDateISO(a)) / MS);
}

function sorted(points) {
  return (points || [])
    .filter(p => {
      if (!p || !p.date) return false;
      // Number(null) and Number('') are both 0, so a missing weight would sail
      // through a bare isFinite check and be charted as zero.
      if (p.value === null || p.value === undefined || p.value === '') return false;
      return Number.isFinite(Number(p.value));
    })
    .map(p => ({ date: p.date, value: Number(p.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Least-squares fit of value against days-since-first-weigh-in.
 *
 * Regressing on the DATE rather than the row index matters: weigh-ins are
 * irregular, so a fit over indices would treat a 30-day gap and a 1-day gap as
 * the same step and tilt the slope toward whichever stretch was logged densely.
 *
 * @returns { slopePerDay, intercept, rmse, n, firstDate } or null when < 2 points
 */
export function linearTrend(points) {
  const pts = sorted(points);
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
  // Every weigh-in on the same day — no slope to speak of.
  if (den === 0) return null;

  const slopePerDay = num / den;
  const intercept = meanY - slopePerDay * meanX;

  // Spread of the actual points around the fitted line. This is what makes a
  // projection honest: a jumpy log widens the band rather than hiding behind a
  // confident-looking number.
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slopePerDay * xs[i];
    sumSq += (ys[i] - fitted) ** 2;
  }
  const rmse = n > 2 ? Math.sqrt(sumSq / (n - 2)) : 0;

  return { slopePerDay, intercept, rmse, n, firstDate };
}

/** Fitted value on a given date, for drawing the trend line. */
export function trendValueOn(trend, date) {
  if (!trend) return null;
  return trend.intercept + trend.slopePerDay * daysBetween(trend.firstDate, date);
}

/**
 * Where the trend lands `daysAhead` from the last weigh-in, with a ± band.
 *
 * Deliberately withheld below 4 weigh-ins or a 7-day span: a line through two
 * or three clustered points extrapolates to nonsense, and a confident-looking
 * projection is worse than none.
 *
 * @returns { value, change, margin, direction } or null
 */
export function projectWeight(points, daysAhead = 7) {
  const pts = sorted(points);
  const trend = linearTrend(pts);
  if (!trend || trend.n < 4) return null;

  const last = pts[pts.length - 1];
  const spanDays = daysBetween(pts[0].date, last.date);
  if (spanDays < 7) return null;

  const fittedNow = trendValueOn(trend, last.date);
  const value = fittedNow + trend.slopePerDay * daysAhead;
  const change = value - last.value;

  return {
    value,
    change,
    // One RMSE either side — roughly "typical" scatter, not a formal CI.
    margin: trend.rmse,
    direction: describeDirection(trend.slopePerDay, last.value),
  };
}

/**
 * Weekly drift below this share of body weight is treated as noise rather than
 * a trend. ~0.22 lb/week at 150 lb, or ~0.1 kg/week at 68 kg — the same
 * real-world line either way.
 */
const FLAT_BAND_PER_WEEK = 0.0015; // 0.15% of body weight

/**
 * Slope → a word.
 *
 * The band is a FRACTION of body weight, not an absolute number, because these
 * values arrive in whichever unit is being displayed. A fixed 0.05/day band was
 * ~0.35 lb a week in US units but ~0.77 lb a week in metric — the same log
 * would be called "holding" in one unit and "down" in the other. It also sat
 * wide enough to label a real 0.3 lb/week cut as holding.
 *
 * @param reference body weight to scale the band against; falls back to a
 *                  fixed band when absent
 */
export function describeDirection(slopePerDay, reference) {
  if (!Number.isFinite(slopePerDay)) return 'flat';
  const band = Number.isFinite(reference) && reference > 0
    ? (reference * FLAT_BAND_PER_WEEK) / 7
    : 0.05;
  if (slopePerDay > band) return 'up';
  if (slopePerDay < -band) return 'down';
  return 'flat';
}

/**
 * The numbers behind the header and the stat tiles.
 *
 * @returns null when there's nothing logged in range
 */
export function summarizeWeights(points) {
  const pts = sorted(points);
  if (pts.length === 0) return null;

  const latest = pts[pts.length - 1];
  const previous = pts.length > 1 ? pts[pts.length - 2] : null;
  const first = pts[0];
  const trend = linearTrend(pts);

  const average = pts.reduce((s, p) => s + p.value, 0) / pts.length;

  return {
    count: pts.length,
    current: latest.value,
    currentDate: latest.date,
    // Movement since the weigh-in before this one — the "vs last" figure.
    changeVsPrevious: previous ? latest.value - previous.value : null,
    average,
    // Movement across the whole visible window, first to last.
    changeOverRange: pts.length > 1 ? latest.value - first.value : null,
    spanDays: daysBetween(first.date, latest.date),
    perWeek: trend ? trend.slopePerDay * 7 : null,
    direction: trend ? describeDirection(trend.slopePerDay, latest.value) : 'flat',
    trend,
  };
}
