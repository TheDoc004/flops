import { groupByDate, sumMacros } from './macros';
import { addDaysLocal } from './dateLocal';
import { goalsToTargets, resolveGoalRowForDate } from './goalAdherence';

export function daysInclusive(start, end) {
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Averages divide by calendar days in range; totals sum logged meals only */
export function computePeriodStats(entries, start, end) {
  const periodDays = daysInclusive(start, end);
  const totals = sumMacros(entries);
  const byDay = groupByDate(entries);
  const divisor = periodDays > 0 ? periodDays : 1;
  return {
    periodDays,
    daysWithEntries: byDay.length,
    totals: {
      calories: totals.calories,
      protein_g: totals.protein_g,
      carbs_g: totals.carbs_g,
      fat_g: totals.fat_g,
    },
    averages: {
      calories: totals.calories / divisor,
      protein_g: totals.protein_g / divisor,
      carbs_g: totals.carbs_g / divisor,
      fat_g: totals.fat_g / divisor,
    },
    dailyRows: byDay,
  };
}

export function averageGoalCalories(goalsPayload, start, end) {
  if (!start || !end) return null;
  let date = start;
  const mins = [];
  const maxs = [];
  for (let i = 0; i < 400; i++) {
    const row = resolveGoalRowForDate(goalsPayload, date);
    const target = goalsToTargets(row).calories;
    if (target) {
      mins.push(target.min);
      maxs.push(target.max);
    }
    if (date === end) break;
    date = addDaysLocal(date, 1);
  }
  if (mins.length === 0 || maxs.length === 0) return null;
  return {
    min: mins.reduce((a, b) => a + b, 0) / mins.length,
    max: maxs.reduce((a, b) => a + b, 0) / maxs.length,
  };
}

export function goalVersionsForRange(goalsPayload, start, end) {
  const versions = Array.isArray(goalsPayload?.versions)
    ? [...goalsPayload.versions].sort((a, b) => String(a.effective_start_date).localeCompare(String(b.effective_start_date)))
    : Array.isArray(goalsPayload?.goals)
      ? [{ effective_start_date: goalsPayload.effective_start_date || null, goals: goalsPayload.goals }]
      : [];
  if (versions.length === 0) return [];
  const eligible = versions.filter(v => !v.effective_start_date || v.effective_start_date <= end);
  if (eligible.length === 0) return [];
  let startIdx = 0;
  for (let i = 0; i < eligible.length; i++) {
    const eff = eligible[i].effective_start_date;
    if (!eff || eff <= start) startIdx = i;
  }
  return eligible.slice(startIdx);
}
