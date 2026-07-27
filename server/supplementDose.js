/**
 * supplementDose — keeps "what the label calls a serving" separate from "what
 * you actually take".
 *
 * Every capture path (photo scan, NIH lookup, AI estimate) reports values for
 * ONE label serving. Storing only a free-text dose meant a label serving of
 * 2 softgels counted as 2 even when you swallow 3 — a silent undercount, and
 * invisible because nothing said the numbers were per label serving.
 *
 * So a supplement now carries the label serving as a quantity + unit, plus the
 * quantity YOU take in that same unit. Everything downstream scales by the
 * ratio between them.
 */

/** "Capsules" -> "capsule", "Gummies" -> "gummy". */
function singularizeUnit(raw) {
  const u = String(raw ?? '').trim().toLowerCase();
  if (!u) return '';
  if (/ies$/.test(u)) return `${u.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(u)) return u; // never strip these
  if (/s$/.test(u)) return u.slice(0, -1);
  return u;
}

/** "capsule" + 3 -> "capsules"; abbreviations and 1 stay as-is. */
function formatUnit(unit, qty) {
  const u = String(unit ?? '').trim();
  if (!u || Number(qty) === 1) return u;
  if (/^(g|mg|mcg|ml|oz|iu)$/i.test(u)) return u;
  if (/y$/i.test(u) && !/[aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(u)) return `${u}es`;
  return `${u}s`;
}

/**
 * Pull a quantity and unit out of a label's serving text.
 * "2 Capsules" -> { qty: 2, unit: 'capsule' }; "1 scoop (32 g)" -> 1 scoop.
 * Returns null when there's no leading number to trust.
 */
function parseServingText(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const m = /^([\d.]+)\s*(.*)$/.exec(s);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  // Drop any parenthetical gram equivalent — "scoop (32 g)" is still a scoop.
  const unit = singularizeUnit(m[2].replace(/\(.*?\)/g, '').trim()) || 'serving';
  return { qty, unit };
}

/**
 * How many label servings a dose represents. Guarded so a missing or zero
 * label serving can never produce Infinity/NaN — it just means "1 serving".
 */
function doseMultiplier({ label_serving_qty, dose_qty } = {}) {
  const label = Number(label_serving_qty);
  const dose = Number(dose_qty);
  if (!Number.isFinite(label) || label <= 0) return 1;
  if (!Number.isFinite(dose) || dose <= 0) return 1;
  return dose / label;
}

/** Scale a flat { key: number } map, dropping anything unusable. */
function scaleValues(values, multiplier) {
  const out = {};
  if (!values || typeof values !== 'object') return out;
  const m = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
  for (const [key, raw] of Object.entries(values)) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) continue;
    out[key] = Math.round(v * m * 100) / 100;
  }
  return out;
}

/** "3 softgels" for display next to the checklist. */
function describeDose(qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${+n.toFixed(2)} ${formatUnit(unit, n)}`.trim();
}

module.exports = {
  parseServingText,
  doseMultiplier,
  scaleValues,
  singularizeUnit,
  formatUnit,
  describeDose,
};
