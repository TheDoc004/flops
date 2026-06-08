/**
 * Very small built-in list for v1 quick logging.
 * Values are approximate macros per 100 g.
 */

export const QUICK_FOODS = [
  { id: 'banana', name: 'Banana', calories_100g: 89, protein_g_100g: 1.1, carbs_g_100g: 22.8, fat_g_100g: 0.3 },
  { id: 'apple', name: 'Apple', calories_100g: 52, protein_g_100g: 0.3, carbs_g_100g: 13.8, fat_g_100g: 0.2 },
  { id: 'orange', name: 'Orange', calories_100g: 47, protein_g_100g: 0.9, carbs_g_100g: 11.8, fat_g_100g: 0.1 },
  { id: 'blueberries', name: 'Blueberries', calories_100g: 57, protein_g_100g: 0.7, carbs_g_100g: 14.5, fat_g_100g: 0.3 },
  { id: 'strawberries', name: 'Strawberries', calories_100g: 32, protein_g_100g: 0.7, carbs_g_100g: 7.7, fat_g_100g: 0.3 },
  { id: 'grapes', name: 'Grapes', calories_100g: 69, protein_g_100g: 0.7, carbs_g_100g: 18.1, fat_g_100g: 0.2 },
  { id: 'avocado', name: 'Avocado', calories_100g: 160, protein_g_100g: 2.0, carbs_g_100g: 8.5, fat_g_100g: 14.7 },

  { id: 'white_rice_cooked', name: 'White rice (cooked)', calories_100g: 130, protein_g_100g: 2.4, carbs_g_100g: 28.2, fat_g_100g: 0.3 },
  { id: 'oats_dry', name: 'Oats (dry)', calories_100g: 389, protein_g_100g: 16.9, carbs_g_100g: 66.3, fat_g_100g: 6.9 },
  { id: 'greek_yogurt_nonfat', name: 'Greek yogurt (nonfat)', calories_100g: 59, protein_g_100g: 10.3, carbs_g_100g: 3.6, fat_g_100g: 0.4 },
  { id: 'milk_2pct', name: 'Milk (2%)', calories_100g: 50, protein_g_100g: 3.4, carbs_g_100g: 4.8, fat_g_100g: 1.9 },

  { id: 'egg_whole', name: 'Egg (whole)', calories_100g: 143, protein_g_100g: 13.0, carbs_g_100g: 1.1, fat_g_100g: 9.5 },
  { id: 'chicken_breast_cooked', name: 'Chicken breast (cooked)', calories_100g: 165, protein_g_100g: 31.0, carbs_g_100g: 0.0, fat_g_100g: 3.6 },
  { id: 'peanut_butter', name: 'Peanut butter', calories_100g: 588, protein_g_100g: 25.1, carbs_g_100g: 20.0, fat_g_100g: 50.0 },

  { id: 'bread', name: 'Bread', calories_100g: 265, protein_g_100g: 9.0, carbs_g_100g: 49.0, fat_g_100g: 3.2 },
  { id: 'cereal', name: 'Cereal', calories_100g: 380, protein_g_100g: 8.0, carbs_g_100g: 84.0, fat_g_100g: 2.0 },
];

export function filterQuickFoods(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...QUICK_FOODS].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const matches = QUICK_FOODS.filter(f => f.name.toLowerCase().includes(q));
  function rank(name) {
    const n = String(name).toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  }
  return matches.sort((a, b) => {
    const ra = rank(a.name);
    const rb = rank(b.name);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function macrosForQuickFoodAmount(food, amount, unit) {
  if (!food) return null;
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return null;
  const grams = unit === 'oz' ? a * 28.349523125 : a;
  const mult = grams / 100;
  return {
    calories: food.calories_100g * mult,
    protein_g: food.protein_g_100g * mult,
    carbs_g: food.carbs_g_100g * mult,
    fat_g: food.fat_g_100g * mult,
  };
}

