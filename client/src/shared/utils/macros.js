/** Calorie contribution by macro (Atwater): protein 4, carbs 4, fat 9 kcal/g */
export function macroCaloriesFromGrams(protein_g, carbs_g, fat_g) {
  const p = Math.max(0, Number(protein_g) || 0);
  const c = Math.max(0, Number(carbs_g) || 0);
  const f = Math.max(0, Number(fat_g) || 0);
  return {
    protein: p * 4,
    carbs: c * 4,
    fat: f * 9,
  };
}

export function mealMacroCalorieBreakdown(entry) {
  const m = computeEntryMacros(entry);
  return macroCaloriesFromGrams(m.protein_g, m.carbs_g, m.fat_g);
}

export function computeEntryMacros(entry) {
  return {
    calories: entry.recipe_calories * entry.servings,
    protein_g: entry.recipe_protein_g * entry.servings,
    carbs_g: entry.recipe_carbs_g * entry.servings,
    fat_g: entry.recipe_fat_g * entry.servings,
  };
}

export function sumMacros(entries) {
  return entries.reduce(
    (acc, entry) => {
      const m = computeEntryMacros(entry);
      acc.calories += m.calories;
      acc.protein_g += m.protein_g;
      acc.carbs_g += m.carbs_g;
      acc.fat_g += m.fat_g;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/**
 * Macros contributed by supplements taken on a day. Rows come from the
 * supplement API (`/today` or `/range`) already scaled to the dose actually
 * taken, so this only filters on the flag and adds — never rescales.
 *
 * Rows from `/range` are already "taken"; rows from `/today` carry a `taken`
 * flag, so untaken ones are skipped here.
 */
export function sumSupplementMacros(supplements) {
  return (supplements || []).reduce(
    (acc, s) => {
      if (!s || !s.counts_toward_macros) return acc;
      if ('taken' in s && !s.taken) return acc;
      acc.calories += Number(s.calories) || 0;
      acc.protein_g += Number(s.protein_g) || 0;
      acc.carbs_g += Number(s.carbs_g) || 0;
      acc.fat_g += Number(s.fat_g) || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/** Add macro totals together (e.g. meals + macro-counting supplements). */
export function addMacroTotals(...totals) {
  return totals.reduce(
    (acc, t) => {
      acc.calories += Number(t?.calories) || 0;
      acc.protein_g += Number(t?.protein_g) || 0;
      acc.carbs_g += Number(t?.carbs_g) || 0;
      acc.fat_g += Number(t?.fat_g) || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/** Subtract one macro total from another (e.g. remove an entry being edited). */
export function subtractMacroTotals(a, b) {
  return {
    calories: (Number(a?.calories) || 0) - (Number(b?.calories) || 0),
    protein_g: (Number(a?.protein_g) || 0) - (Number(b?.protein_g) || 0),
    carbs_g: (Number(a?.carbs_g) || 0) - (Number(b?.carbs_g) || 0),
    fat_g: (Number(a?.fat_g) || 0) - (Number(b?.fat_g) || 0),
  };
}

/** Scale a macro total by a factor (e.g. recipe servings being logged). */
export function scaleMacroTotals(t, factor) {
  const f = Number(factor);
  const n = Number.isFinite(f) ? f : 1;
  return {
    calories: (Number(t?.calories) || 0) * n,
    protein_g: (Number(t?.protein_g) || 0) * n,
    carbs_g: (Number(t?.carbs_g) || 0) * n,
    fat_g: (Number(t?.fat_g) || 0) * n,
  };
}

/**
 * Goal-range status for a single macro — same rules as MacroTotals rings.
 * @returns {{ mod: 'muted'|'ok'|'over', kind: 'none'|'below'|'ok'|'over', delta: number }}
 */
export function macroGoalStatus(value, target) {
  if (target?.max == null) return { mod: 'muted', kind: 'none', delta: 0 };
  const v = Number(value) || 0;
  const min = Number(target.min);
  const max = Number(target.max);
  if (v > max) return { mod: 'over', kind: 'over', delta: v - max };
  if (Number.isFinite(min) && v < min) return { mod: 'muted', kind: 'below', delta: min - v };
  return { mod: 'ok', kind: 'ok', delta: 0 };
}

/**
 * Parse a log entry's stored per-ingredient breakdown (Phase 1). Returns an
 * array of rows or null when absent/invalid. Old entries (no ingredients_json)
 * return null so callers fall back to showing totals only. Never throws.
 */
export function parseLoggedIngredients(entry) {
  const raw = entry?.ingredients_json;
  if (!raw) return null;
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
  if (!Array.isArray(v) || v.length === 0) return null;
  const rows = v.filter(r => r && typeof r === 'object' && r.name != null);
  return rows.length ? rows : null;
}

/** Scale per-serving ingredient rows by servings (for display, like totals). */
export function scaleIngredientRows(rows, servings) {
  const s = Number(servings) > 0 ? Number(servings) : 1;
  return (rows || []).map(r => ({
    ...r,
    calories: (Number(r.calories) || 0) * s,
    protein_g: (Number(r.protein_g) || 0) * s,
    carbs_g: (Number(r.carbs_g) || 0) * s,
    fat_g: (Number(r.fat_g) || 0) * s,
    ...(r.fiber_g != null ? { fiber_g: (Number(r.fiber_g) || 0) * s } : {}),
  }));
}

/** Sum ingredient rows into a macro total (the "total = sum of rows" view). */
export function sumIngredientRows(rows) {
  return (rows || []).reduce(
    (acc, r) => {
      acc.calories += Number(r.calories) || 0;
      acc.protein_g += Number(r.protein_g) || 0;
      acc.carbs_g += Number(r.carbs_g) || 0;
      acc.fat_g += Number(r.fat_g) || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

export function groupByDate(entries) {
  const map = {};
  for (const entry of entries) {
    if (!map[entry.date]) {
      map[entry.date] = { date: entry.date, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    }
    const m = computeEntryMacros(entry);
    map[entry.date].calories += m.calories;
    map[entry.date].protein_g += m.protein_g;
    map[entry.date].carbs_g += m.carbs_g;
    map[entry.date].fat_g += m.fat_g;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}
