/**
 * Heuristic meal → training window readiness from logged macros and daily training context.
 * Not sports-science precision — practical green/yellow/red for 15–45, 45–90, 90–180 min windows.
 */

import { clamp } from './trainingFuel';

export const TRAINING_CONTEXT_IDS = [
  'rest',
  'light_cardio',
  'medium',
  'heavy_lifting',
  'heavy_cardio',
];

export const TRAINING_CONTEXT_LABELS = {
  rest: 'Rest day',
  light_cardio: 'Light cardio',
  medium: 'Medium workout',
  heavy_lifting: 'Heavy lifting',
  heavy_cardio: 'Heavy cardio',
};

/** @typedef {'green'|'yellow'|'red'} TrafficLight */

const WINDOW_DEFS = [
  { id: '15-45', label: '15–45 min', key: 'early' },
  { id: '45-90', label: '45–90 min', key: 'mid' },
  { id: '90-180', label: '90–180 min', key: 'late' },
];

const CONTEXT_META = {
  rest: { intensity: 0, carbBias: 0 },
  light_cardio: { intensity: 1, carbBias: 0.35 },
  medium: { intensity: 2, carbBias: 0.55 },
  heavy_lifting: { intensity: 4, carbBias: 0.85 },
  heavy_cardio: { intensity: 4, carbBias: 0.9 },
};

function lightFromScore(score) {
  if (score >= 68) return 'green';
  if (score >= 44) return 'yellow';
  return 'red';
}

/**
 * @param {object} p
 * @param {number} p.calories
 * @param {number} p.protein_g
 * @param {number} p.carbs_g
 * @param {number} p.fat_g
 * @param {number} [p.fiber_g]
 * @param {string} p.contextType
 * @param {number} [p.bodyWeightKg]
 * @param {string} [p.digestionPref]
 */
export function computeMealTrainingReadiness(p) {
  const contextType = p.contextType && TRAINING_CONTEXT_IDS.includes(p.contextType) ? p.contextType : 'rest';
  const label = TRAINING_CONTEXT_LABELS[contextType] || contextType;

  if (contextType === 'rest') {
    return {
      contextType,
      contextLabel: label,
      isRest: true,
      windows: null,
      bestWindow: null,
      summary: 'Rest day — no training fuel check needed.',
      note: '',
      suggestion: '',
    };
  }

  const cal = Math.max(Number(p.calories) || 0, 1);
  const protein_g = Number(p.protein_g) || 0;
  const carbs_g = Number(p.carbs_g) || 0;
  const fat_g = Number(p.fat_g) || 0;
  const fiber_g = Number(p.fiber_g) || 0;

  const fatKcal = fat_g * 9;
  const fatPct = fatKcal / cal;
  const bw = clamp(Number(p.bodyWeightKg) || 72, 45, 150);
  const carbsPerKg = carbs_g / bw;

  const meta = CONTEXT_META[contextType] || CONTEXT_META.medium;
  const { intensity, carbBias } = meta;

  const idealCarbPerKg = {
    early: 0.22 + intensity * 0.11 * carbBias * 1.15,
    mid: 0.18 + intensity * 0.09 * carbBias,
    late: 0.14 + intensity * 0.07 * carbBias,
  };

  const digestionPref = p.digestionPref || 'none';
  const sensitive = digestionPref === 'sensitive';
  const preferLowFat = digestionPref === 'lower_fat';

  /**
   * @param {'early'|'mid'|'late'} wk
   */
  function scoreWindow(wk) {
    let s = 68;
    const ideal = idealCarbPerKg[wk];
    const ratio = ideal > 0 ? carbsPerKg / ideal : 0;

    if (ratio >= 0.92) s += 14;
    else if (ratio >= 0.65) s += 6;
    else if (ratio < 0.45) s -= 10 + intensity * 2.5;

    if (wk === 'early') {
      if (fatPct > 0.44) s -= 24;
      else if (fatPct > 0.34) s -= 14;
      else if (fatPct > 0.26) s -= 7;
      if (cal > 920) s -= 16;
      else if (cal > 720) s -= 9;
      else if (cal > 520) s -= 4;
      if (fiber_g > 14) s -= 14;
      else if (fiber_g > 10) s -= 7;
      if (sensitive && fatPct > 0.24) s -= 6;
      if (preferLowFat && fatPct > 0.28) s -= 5;
    } else if (wk === 'mid') {
      if (fatPct > 0.48) s -= 14;
      else if (fatPct > 0.36) s -= 7;
      if (cal > 1050) s -= 10;
      if (fiber_g > 16) s -= 6;
    } else {
      if (fatPct > 0.52) s -= 8;
      if (cal > 1300) s -= 5;
    }

    // Very low total energy
    if (cal < 220 && (wk === 'early' || wk === 'mid')) s -= 6;

    // Heavy days: penalize low carb harder
    if (intensity >= 3 && ratio < 0.55 && wk !== 'late') s -= 8;

    // Protein-heavy + low carb on hard days
    const proteinRatio = (protein_g * 4) / cal;
    if (intensity >= 3 && proteinRatio > 0.38 && carbsPerKg < ideal * 0.55) s -= 6;

    return clamp(s, 0, 100);
  }

  const scores = {
    early: scoreWindow('early'),
    mid: scoreWindow('mid'),
    late: scoreWindow('late'),
  };

  const windows = WINDOW_DEFS.map(w => ({
    id: w.id,
    label: w.label,
    light: lightFromScore(scores[w.key]),
    score: scores[w.key],
  }));

  let bestKey = 'early';
  let bestScore = scores.early;
  if (scores.mid > bestScore) {
    bestKey = 'mid';
    bestScore = scores.mid;
  }
  if (scores.late > bestScore) {
    bestKey = 'late';
    bestScore = scores.late;
  }

  const bestDef = WINDOW_DEFS.find(x => x.key === bestKey);
  const bestWindow = bestDef ? { id: bestDef.id, label: bestDef.label } : null;

  const parts = [];
  if (fatPct > 0.36 && scores.early < scores.late) {
    parts.push('Higher fat — usually easier to train after a longer break than in the first hour.');
  }
  if (cal > 850 && scores.early < 60) {
    parts.push('Fairly large meal — may feel heavy for very soon training.');
  }
  if (intensity >= 3 && carbsPerKg < idealCarbPerKg.mid * 0.55) {
    parts.push('Carbs are on the low side for a higher-output day.');
  }

  let suggestion = '';
  if (intensity >= 2 && carbsPerKg < idealCarbPerKg.early * 0.6) {
    suggestion = 'A little more carbs may help for a higher-output session.';
  } else if (fatPct > 0.38) {
    suggestion = 'If training soon, something lower-fat next time may sit lighter.';
  } else if (windows[0].light === 'green' || windows[0].light === 'yellow') {
    suggestion = 'Looks reasonable for training within a couple of hours.';
  } else {
    suggestion = 'Consider a longer gap before hard work, or a lighter top-up if training soon.';
  }

  const summary = bestWindow
    ? `Best training window for this meal: ${bestWindow.label}.`
    : '';

  const note = parts.length ? parts.join(' ') : '';

  return {
    contextType,
    contextLabel: label,
    isRest: false,
    windows,
    bestWindow,
    summary,
    note,
    suggestion,
  };
}
