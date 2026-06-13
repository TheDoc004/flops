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
