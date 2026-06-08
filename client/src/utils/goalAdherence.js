import { getIsoWeekday } from './weekday';
import { addDaysLocal, getLocalDateISO, parseLocalDateISO } from './dateLocal';
import { formatMacroMass } from './macroUnits';

export const ADHERENCE_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

export const ADHERENCE_LABELS = {
  calories: 'Calories',
  protein_g: 'Protein',
  carbs_g: 'Carbs',
  fat_g: 'Fat',
};

function normalizeFinite(n) {
  return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
}

export function normalizeTargetRange(minRaw, maxRaw, legacyRaw) {
  let min = normalizeFinite(minRaw);
  let max = normalizeFinite(maxRaw);

  if (min == null && max == null && legacyRaw !== undefined) {
    const exact = normalizeFinite(legacyRaw);
    min = exact;
    max = exact;
  }

  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;
  if (min == null || max == null) return null;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function goalsToTargets(goalRow) {
  if (!goalRow) {
    return { calories: null, protein_g: null, carbs_g: null, fat_g: null };
  }
  return {
    calories: normalizeTargetRange(goalRow.calories_min, goalRow.calories_max, goalRow.calories),
    protein_g: normalizeTargetRange(goalRow.protein_g_min, goalRow.protein_g_max, goalRow.protein_g),
    carbs_g: normalizeTargetRange(goalRow.carbs_g_min, goalRow.carbs_g_max, goalRow.carbs_g),
    fat_g: normalizeTargetRange(goalRow.fat_g_min, goalRow.fat_g_max, goalRow.fat_g),
  };
}

export function hasAnyTarget(targets) {
  return ADHERENCE_KEYS.some(key => targets?.[key] != null);
}

export function targetIncludesValue(actual, range) {
  if (!range) return null;
  const a = Number(actual);
  if (!Number.isFinite(a)) return false;
  return a >= range.min && a <= range.max;
}

function resolveRangeDelta(actual, range) {
  if (!range) return null;
  const a = Number(actual);
  if (!Number.isFinite(a)) return null;
  if (a < range.min) return { direction: 'under', amount: range.min - a };
  if (a > range.max) return { direction: 'over', amount: a - range.max };
  return { direction: 'in_range', amount: 0 };
}

function getVersions(goalSource) {
  if (!goalSource) return [];
  if (Array.isArray(goalSource)) {
    if (goalSource.length > 0 && goalSource[0] && Array.isArray(goalSource[0].goals)) return goalSource;
    return [{ effective_start_date: null, goals: goalSource }];
  }
  if (Array.isArray(goalSource.versions)) return goalSource.versions;
  if (Array.isArray(goalSource.goals)) return [{ effective_start_date: null, goals: goalSource.goals }];
  return [];
}

export function resolveGoalVersionForDate(goalSource, date) {
  const versions = getVersions(goalSource);
  let chosen = null;
  for (const version of versions) {
    const eff = version?.effective_start_date;
    if (!eff) {
      if (!chosen) chosen = version;
      continue;
    }
    if (typeof date === 'string' && eff <= date && (!chosen?.effective_start_date || eff > chosen.effective_start_date)) {
      chosen = version;
    }
  }
  return chosen;
}

export function resolveGoalRowsForDate(goalSource, date) {
  return resolveGoalVersionForDate(goalSource, date)?.goals || [];
}

export function resolveGoalRowForDate(goalSource, date) {
  if (!date) return null;
  const rows = resolveGoalRowsForDate(goalSource, date);
  const weekday = getIsoWeekday(parseLocalDateISO(date));
  return rows.find(r => r.weekday === weekday) || null;
}

export function evaluateAdherence(totals, targets) {
  if (!hasAnyTarget(targets)) {
    return { status: 'no_target', missed: [] };
  }

  const actual = {
    calories: Number(totals.calories ?? 0),
    protein_g: Number(totals.protein_g ?? 0),
    carbs_g: Number(totals.carbs_g ?? 0),
    fat_g: Number(totals.fat_g ?? 0),
  };

  const definedKeys = ADHERENCE_KEYS.filter(key => targets[key] != null);
  const missed = definedKeys
    .filter(key => targetIncludesValue(actual[key], targets[key]) === false)
    .map(key => ({ key, label: ADHERENCE_LABELS[key] }));

  if (missed.length === 0) return { status: 'hit', missed: [] };
  if (missed.length === definedKeys.length) return { status: 'miss', missed };
  return { status: 'partial', missed };
}

export function evaluateAdherenceForDay({ date, totals, targets, hasData, todayIso }) {
  const today = todayIso || getLocalDateISO();

  if (!hasAnyTarget(targets)) {
    return { status: 'no_target', missed: [] };
  }

  if (date && typeof date === 'string' && date > today) {
    return { status: 'upcoming', missed: [] };
  }

  if (!hasData) {
    return { status: 'no_data', missed: [] };
  }

  return evaluateAdherence(totals, targets);
}

export function listLocalDatesInclusive(startIso, endIso) {
  const out = [];
  let d = startIso;
  for (let i = 0; i < 400; i++) {
    out.push(d);
    if (d === endIso) break;
    d = addDaysLocal(d, 1);
  }
  return out;
}

export function buildWeeklyAdherenceRows(goalSource, dayTotalsOrdered, { todayIso } = {}) {
  return dayTotalsOrdered.map(day => {
    const weekday = getIsoWeekday(parseLocalDateISO(day.date));
    const row = resolveGoalRowForDate(goalSource, day.date);
    const targets = goalsToTargets(row);
    const totals = {
      calories: day.calories ?? 0,
      protein_g: day.protein_g ?? 0,
      carbs_g: day.carbs_g ?? 0,
      fat_g: day.fat_g ?? 0,
    };
    const hasData = day.hasData === false ? false : true;
    const ev = evaluateAdherenceForDay({ date: day.date, totals, targets, hasData, todayIso });
    return {
      date: day.date,
      weekday,
      totals,
      targets,
      hasData,
      goal_effective_start_date: resolveGoalVersionForDate(goalSource, day.date)?.effective_start_date || null,
      ...ev,
    };
  });
}

export function formatTargetRangeDisplay(key, range, macroUnits) {
  if (!range) return '—';
  if (key === 'calories') {
    return range.min === range.max
      ? `${Math.round(range.min)} kcal`
      : `${Math.round(range.min)}–${Math.round(range.max)} kcal`;
  }
  return range.min === range.max
    ? formatMacroMass(range.min, macroUnits)
    : `${formatMacroMass(range.min, macroUnits)} – ${formatMacroMass(range.max, macroUnits)}`;
}

function formatActualDisplay(key, value, macroUnits) {
  if (value === null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return key === 'calories' ? `${Math.round(n)} kcal` : formatMacroMass(n, macroUnits);
}

export function buildDayAdherenceDetail(totals, targets, macroUnits, { status, hasData } = {}) {
  const effectiveStatus = status || evaluateAdherence(totals, targets).status;
  const treatAsNoData = effectiveStatus === 'no_data' || effectiveStatus === 'upcoming' || hasData === false;
  const ev = treatAsNoData ? { status: effectiveStatus, missed: [] } : evaluateAdherence(totals, targets);

  const categories = ADHERENCE_KEYS.map(key => {
    const range = targets[key];
    const actual = Number(totals[key] ?? 0);
    const hit = targetIncludesValue(actual, range);
    const delta = resolveRangeDelta(actual, range);

    if (treatAsNoData) {
      return {
        key,
        label: ADHERENCE_LABELS[key],
        goalDisplay: formatTargetRangeDisplay(key, range, macroUnits),
        actualDisplay: '—',
        bandDisplay: range ? (range.min === range.max ? 'Exact target' : 'Saved range') : '—',
        deltaLabel: effectiveStatus === 'upcoming' ? 'Upcoming' : 'Not logged',
        toleranceOk: null,
        missedTolerance: false,
      };
    }

    let deltaLabel = 'No target';
    if (range) {
      if (hit) {
        deltaLabel = 'In range';
      } else if (delta?.direction === 'under') {
        deltaLabel = key === 'calories'
          ? `Under by ${Math.round(delta.amount)} kcal`
          : `Under by ${formatMacroMass(delta.amount, macroUnits)}`;
      } else if (delta?.direction === 'over') {
        deltaLabel = key === 'calories'
          ? `Over by ${Math.round(delta.amount)} kcal`
          : `Over by ${formatMacroMass(delta.amount, macroUnits)}`;
      }
    }

    return {
      key,
      label: ADHERENCE_LABELS[key],
      goalDisplay: formatTargetRangeDisplay(key, range, macroUnits),
      actualDisplay: formatActualDisplay(key, actual, macroUnits),
      bandDisplay: range ? (range.min === range.max ? 'Exact target' : 'Saved range') : '—',
      deltaLabel,
      toleranceOk: hit === true,
      missedTolerance: range != null && hit === false,
    };
  });

  return {
    status: ev.status,
    missed: ev.missed,
    categories,
  };
}
