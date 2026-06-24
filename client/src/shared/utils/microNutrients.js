/**
 * Pure helpers for reading, aggregating, and scoring micronutrient estimates
 * stored on log entries (`micros_json`). No side effects, no API calls.
 * Missing / malformed micros must never throw — callers can rely on safe empties.
 */
import { MICRO_NUTRIENTS, MICRO_KEYS, MICRO_BY_KEY } from '@shared/config/microNutrients';

/* Status color system (req 8):
   <33% red · 33–66% yellow · 66–99% green · ≥100% purple (met)
   over upper limit → orange · watch nutrient (e.g. sodium) → neutral, orange if over. */
const COLORS = {
  low:     { bar: '#ef4444', track: '#fee2e2', text: '#991b1b', label: 'Low' },
  partial: { bar: '#f59e0b', track: '#fef3c7', text: '#92400e', label: 'Partial' },
  good:    { bar: '#10b981', track: '#d1fae5', text: '#065f46', label: 'On track' },
  met:     { bar: '#7c3aed', track: '#ede9fe', text: '#5b21b6', label: 'Target met' },
  over:    { bar: '#f97316', track: '#ffedd5', text: '#9a3412', label: 'Above limit' },
  watch:   { bar: '#64748b', track: '#e2e8f0', text: '#475569', label: 'Watch' },
  none:    { bar: '#cbd5e1', track: '#f1f5f9', text: '#94a3b8', label: 'No estimate' },
};

const CONF_RANK = { low: 0, medium: 1, high: 2 };

function lowestConfidence(list) {
  if (!list || list.length === 0) return null;
  return list.reduce((acc, c) => ((CONF_RANK[c] ?? 0) < (CONF_RANK[acc] ?? 0) ? c : acc), list[0]);
}

/** Read a log entry's stored micro estimate. Returns null if absent/invalid. */
export function parseMicros(entry) {
  const raw = entry?.micros_json;
  if (!raw) return null;
  let p;
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
  if (!p || typeof p !== 'object' || !p.micros || typeof p.micros !== 'object') return null;
  return p; // { micros, confidence, notes, version, estimatedAt }
}

/** Sum a day's micros across its entries (scaled by servings). Safe on empties. */
export function sumDayMicros(entries) {
  const values = {};
  const confs = [];
  let withMicros = 0;
  for (const e of entries || []) {
    const m = parseMicros(e);
    if (!m) continue;
    withMicros += 1;
    if (m.confidence) confs.push(m.confidence);
    const mult = Number(e?.servings) > 0 ? Number(e.servings) : 1;
    for (const k of MICRO_KEYS) {
      const v = Number(m.micros[k]);
      if (Number.isFinite(v) && v >= 0) values[k] = (values[k] || 0) + v * mult;
    }
  }
  return {
    values,
    coverage: { withMicros, total: (entries || []).length },
    confidence: lowestConfidence(confs),
    hasMicros: withMicros > 0,
  };
}

/** Status (% of target, fill, color, label) for one nutrient value. */
export function statusFor(key, value) {
  const def = MICRO_BY_KEY[key];
  const v = Number(value) || 0;
  if (!def) return { key, value: v, pct: 0, fillPct: 0, isWatch: false, over: false, ...COLORS.none, color: COLORS.none.bar, textColor: COLORS.none.text, track: COLORS.none.track };

  if (def.watch && def.upperLimit) {
    const pct = v / def.upperLimit;
    const over = v > def.upperLimit;
    const c = over ? COLORS.over : COLORS.watch;
    return { key, def, value: v, pct, fillPct: Math.min(pct, 1), isWatch: true, over, color: c.bar, track: c.track, textColor: c.text, label: over ? 'Above limit' : 'Watch' };
  }

  const pct = def.target ? v / def.target : 0;
  let c;
  if (def.upperLimit && v > def.upperLimit) c = COLORS.over;
  else if (pct >= 1) c = COLORS.met;
  else if (pct >= 0.66) c = COLORS.good;
  else if (pct >= 0.33) c = COLORS.partial;
  else c = COLORS.low;
  return { key, def, value: v, pct, fillPct: Math.min(pct, 1), isWatch: false, over: !!(def.upperLimit && v > def.upperLimit), color: c.bar, track: c.track, textColor: c.text, label: c.label };
}

/** Nutrients below `threshold` of target (excludes watch nutrients), lowest first. */
export function nutrientsNeedingAttention(values, { limit = 4, threshold = 0.66 } = {}) {
  const out = [];
  for (const def of MICRO_NUTRIENTS) {
    if (def.watch) continue;
    const v = Number(values?.[def.key]) || 0;
    const pct = def.target ? v / def.target : 0;
    if (pct < threshold) out.push({ key: def.key, name: def.name, pct, value: v, def });
  }
  out.sort((a, b) => a.pct - b.pct);
  return out.slice(0, limit);
}

/**
 * Per-nutrient stats across selected days (req 10). For each nutrient: average
 * intake and a days-below-target count — computed only over days that actually
 * have micro estimates, so "no estimate" days aren't counted as gaps.
 * @param perDay [{ date, micros: <sumDayMicros result> }]
 */
export function aggregateRangeMicros(perDay) {
  const result = {};
  for (const def of MICRO_NUTRIENTS) {
    let sum = 0, daysWith = 0, daysBelow = 0;
    for (const d of perDay || []) {
      const dm = d?.micros;
      if (!dm || !dm.hasMicros) continue;
      const v = Number(dm.values?.[def.key]);
      if (!Number.isFinite(v)) continue;
      daysWith += 1;
      sum += v;
      if (def.watch) { if (def.upperLimit && v > def.upperLimit) daysBelow += 1; }
      else if (def.target && v < def.target) daysBelow += 1;
    }
    const avg = daysWith ? sum / daysWith : 0;
    const target = def.watch ? def.upperLimit : def.target;
    result[def.key] = { def, avg, daysWith, daysBelow, avgPct: target ? avg / target : 0 };
  }
  return result;
}

/** Rough coverage score (0–1): average %-of-target across non-watch nutrients. For sorting only — NOT a nutrition score. */
export function microCoverageScore(values) {
  let s = 0, n = 0;
  for (const def of MICRO_NUTRIENTS) {
    if (def.watch) continue;
    const v = Number(values?.[def.key]) || 0;
    s += def.target ? Math.min(v / def.target, 1) : 0;
    n += 1;
  }
  return n ? s / n : 0;
}

/* ── Sorting foundation for selected-day reports (req 12) ── */
export const DAY_SORTS = [
  { key: 'date_desc', label: 'Date (newest)' },
  { key: 'date_asc', label: 'Date (oldest)' },
  { key: 'cal_desc', label: 'Most calories' },
  { key: 'cal_asc', label: 'Fewest calories' },
  { key: 'micro_desc', label: 'Best micro coverage' },
  { key: 'micro_asc', label: 'Worst micro coverage' },
];

/** Sort day-report objects (each: { date, totals:{calories}, micros:{values} }). */
export function sortDays(days, sortKey) {
  const arr = [...(days || [])];
  const cal = d => Number(d?.totals?.calories) || 0;
  const cov = d => microCoverageScore(d?.micros?.values);
  switch (sortKey) {
    case 'date_asc': return arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    case 'cal_desc': return arr.sort((a, b) => cal(b) - cal(a));
    case 'cal_asc': return arr.sort((a, b) => cal(a) - cal(b));
    case 'micro_desc': return arr.sort((a, b) => cov(b) - cov(a));
    case 'micro_asc': return arr.sort((a, b) => cov(a) - cov(b));
    case 'date_desc':
    default: return arr.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
}
