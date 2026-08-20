/** Suggest plates per side for a barbell load. Client math only. */

const LB_PLATES = [45, 35, 25, 10, 5, 2.5];
const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export function platePlan(target, { unit = 'lb', bar } = {}) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return null;
  const barW = bar != null ? Number(bar) : (unit === 'kg' ? 20 : 45);
  if (t < barW) return { bar: barW, perSide: 0, plates: [], leftover: t - barW, unit };
  let remaining = (t - barW) / 2;
  const sizes = unit === 'kg' ? KG_PLATES : LB_PLATES;
  const plates = [];
  for (const p of sizes) {
    const n = Math.floor((remaining + 1e-9) / p);
    if (n > 0) {
      plates.push({ weight: p, count: n });
      remaining = round2(remaining - n * p);
    }
  }
  return {
    bar: barW,
    perSide: round2((t - barW) / 2),
    plates,
    leftover: Math.abs(remaining) < 0.05 ? 0 : round2(remaining),
    unit,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
