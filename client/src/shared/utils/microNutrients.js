/**
 * Pure helpers for reading, aggregating, and scoring micronutrient estimates
 * stored on log entries (`micros_json`). No side effects, no API calls.
 * Missing / malformed micros must never throw — callers can rely on safe empties.
 */
import { MICRO_NUTRIENTS, MICRO_KEYS, MICRO_BY_KEY } from '@shared/config/microNutrients';

/* Status color system — color communicates STATUS, not nutrient identity.
   A muted palette plus a single neutral track keeps the section calm to scan:
     red    = low / needs attention  (0–33% of target)
     amber  = needs work             (34–74%)
     green  = good                   (75–100%)
     purple = over target            (>100%)
     blue-gray = limit-based nutrient (e.g. sodium); turns red if over the limit. */
const TRACK = '#eef1f4'; // one muted track behind every bar
export const MICRO_STATUS = {
  low:     { bar: '#d56a6a', track: TRACK, text: '#9b2c2c', label: 'Low' },
  partial: { bar: '#dda23f', track: TRACK, text: '#92400e', label: 'Needs work' },
  good:    { bar: '#46a585', track: TRACK, text: '#1d7a5f', label: 'Good' },
  met:     { bar: '#8770c9', track: TRACK, text: '#5b21b6', label: 'Over target' },
  watch:   { bar: '#7c8a9c', track: TRACK, text: '#475569', label: 'Limit' },
  none:    { bar: '#cbd5e1', track: TRACK, text: '#94a3b8', label: 'No estimate' },
};

/* Compact color key shown above the bars. */
export const MICRO_LEGEND = ['low', 'partial', 'good', 'met', 'watch'].map(k => ({
  key: k, color: MICRO_STATUS[k].bar, label: MICRO_STATUS[k].label,
}));

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
  // An empty or all-zero micros object is not a real estimate — treat as "no
  // estimate" so it isn't counted as estimated/high-confidence (self-heals any
  // such blob that was stored before the server-side guard existed).
  if (!Object.values(p.micros).some(v => Number(v) > 0)) return null;
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

/**
 * A day's micros combining logged meals (AI estimates) with taken supplements
 * (label-exact). Supplement micros are summed on top of the meal totals and are
 * treated as HIGH confidence, so they never drag down the day's confidence
 * (which reflects the food estimates). Returns the same shape as sumDayMicros,
 * plus `supplementCount` for a UI note.
 *
 * @param entries      log entries for the day
 * @param supplements  taken supplements for the day, each with a `micros`
 *                     object { key: amount } (from GET /api/supplements/range)
 */
export function sumDayTotalMicros({ entries, supplements } = {}) {
  const base = sumDayMicros(entries);
  const suppList = Array.isArray(supplements) ? supplements : [];
  const values = { ...base.values };
  let supplementCount = 0;
  for (const s of suppList) {
    const m = s?.micros;
    if (!m || typeof m !== 'object') continue;
    let contributed = false;
    for (const k of MICRO_KEYS) {
      const v = Number(m[k]);
      if (Number.isFinite(v) && v > 0) {
        values[k] = (values[k] || 0) + v;
        contributed = true;
      }
    }
    if (contributed) supplementCount += 1;
  }
  return {
    values,
    coverage: base.coverage,
    // Foods drive confidence; supplements are exact and only added when present.
    confidence: base.hasMicros ? base.confidence : (supplementCount > 0 ? 'high' : base.confidence),
    hasMicros: base.hasMicros || supplementCount > 0,
    supplementCount,
  };
}

/** Status (% of target, fill, color, label) for one nutrient value. */
export function statusFor(key, value) {
  const def = MICRO_BY_KEY[key];
  const v = Number(value) || 0;
  if (!def) {
    const c = MICRO_STATUS.none;
    return { key, value: v, pct: 0, fillPct: 0, isWatch: false, over: false, color: c.bar, track: c.track, textColor: c.text, label: c.label };
  }

  // Limit-based nutrient (e.g. sodium): neutral by default, red when over.
  if (def.watch && def.upperLimit) {
    const pct = v / def.upperLimit;
    const over = v > def.upperLimit;
    const c = over ? MICRO_STATUS.low : MICRO_STATUS.watch;
    return { key, def, value: v, pct, fillPct: Math.min(pct, 1), isWatch: true, over, color: c.bar, track: c.track, textColor: c.text, label: over ? 'Over limit' : 'Limit' };
  }

  // Target-based: 0–33 low · 34–74 needs work · 75–100 good · >100 over target.
  const pct = def.target ? v / def.target : 0;
  let c, label;
  if (def.upperLimit && v > def.upperLimit) { c = MICRO_STATUS.met; label = 'Over upper limit'; }
  else if (pct > 1) { c = MICRO_STATUS.met; label = 'Over target'; }
  else if (pct >= 0.75) { c = MICRO_STATUS.good; label = 'Good'; }
  else if (pct >= 0.34) { c = MICRO_STATUS.partial; label = 'Needs work'; }
  else { c = MICRO_STATUS.low; label = 'Low'; }
  return { key, def, value: v, pct, fillPct: Math.min(pct, 1), isWatch: false, over: !!(def.upperLimit && v > def.upperLimit), color: c.bar, track: c.track, textColor: c.text, label };
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
