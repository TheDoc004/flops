/** 1RM formulas. For 1 rep, 1RM is the weight itself. */

export const ONE_RM_FORMULAS = [
  { id: 'epley', label: 'Epley' },
  { id: 'brzycki', label: 'Brzycki' },
  { id: 'lander', label: 'Lander' },
  { id: 'oconnor', label: "O'Connor" },
  { id: 'average', label: 'Average' },
];

export function estimateOneRm(weight, reps, formula = 'epley') {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(r) || r < 1) return null;
  if (r === 1) return round1(w);

  const epley = w * (1 + r / 30);
  const brzycki = r >= 37 ? epley : (w * 36) / (37 - r);
  const lander = (100 * w) / (101.3 - 2.67123 * r);
  const oconnor = w * (1 + 0.025 * r);
  const map = { epley, brzycki, lander, oconnor, average: (epley + brzycki + lander + oconnor) / 4 };
  const v = map[formula] ?? epley;
  return Number.isFinite(v) && v > 0 ? round1(v) : null;
}

/** Standard % of 1RM → predicted reps. */
export const PERCENT_TABLE = [
  { pct: 100, reps: 1 },
  { pct: 95, reps: 2 },
  { pct: 90, reps: 4 },
  { pct: 85, reps: 6 },
  { pct: 80, reps: 8 },
  { pct: 75, reps: 10 },
  { pct: 70, reps: 12 },
  { pct: 65, reps: 15 },
  { pct: 60, reps: 18 },
  { pct: 55, reps: 22 },
  { pct: 50, reps: 25 },
];

export function percentChart(oneRm) {
  if (!oneRm) return [];
  return PERCENT_TABLE.map(row => ({
    ...row,
    weight: round1(oneRm * (row.pct / 100)),
  }));
}

/** X-rep max: weight you could lift for N reps, inverted Epley. */
export function xrmWeight(oneRm, reps) {
  if (!oneRm || reps < 1) return null;
  if (reps === 1) return round1(oneRm);
  return round1(oneRm / (1 + reps / 30));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
