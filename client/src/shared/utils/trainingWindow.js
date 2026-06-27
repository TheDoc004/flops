/**
 * Training Fuel Timing Assistant — deterministic, no AI call.
 *
 * Given a logged meal (macros + optional ingredient rows) and an intended
 * activity, estimate the ideal post-meal training window and a plain-language
 * recommendation. All heuristics; safe on missing data.
 *
 * meal = {
 *   eatenMinutesOfDay,        // minutes since midnight, or null if unknown
 *   nowMinutesOfDay,          // minutes since midnight (for "minutes since meal")
 *   totalCalories, protein, carbs, fat, fiber,
 *   ingredients: [{ name, calories, protein, carbs, fat, fiber }]
 * }
 * activity = { type: 'lifting'|'basketball'|'cardio'|'walk'|'rest', intensity: 'light'|'moderate'|'hard' }
 */

const round5 = n => Math.round(n / 5) * 5;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const ACTIVITY_TYPES = [
  { value: 'lifting', label: 'Lifting' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'walk', label: 'Walk' },
  { value: 'rest', label: 'Rest' },
];
export const INTENSITIES = [
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
];

// Ingredient name keywords -> digestion tags.
const KEYWORDS = {
  fast_carb: ['honey', 'syrup', 'jam', 'jelly', 'juice', 'gatorade', 'powerade', 'soda', 'candy', 'gummy', 'sugar', 'dates', 'date ', 'white bread', 'bagel', 'rice krispie', 'krispies', 'corn flake', 'cornflake', 'fruit snack', 'dextrose', 'glucose', 'sports drink', 'pop tart', 'poptart', 'white toast', 'pretzel', 'sourdough'],
  moderate_carb: ['white rice', 'jasmine', 'basmati', 'rice', 'potato', 'pasta', 'tortilla', 'noodle', 'bread', 'pita', 'cracker', 'couscous', 'bun', 'bagel', 'banana', 'grape'],
  slow_carb: ['oat', 'oatmeal', 'bean', 'lentil', 'chickpea', 'quinoa', 'sweet potato', 'brown rice', 'whole grain', 'whole wheat', 'whole-wheat', 'barley', 'farro', 'bran', 'high fiber', 'high-fiber'],
  high_fiber: ['oat', 'bean', 'lentil', 'chickpea', 'broccoli', 'avocado', 'berry', 'berries', 'blueberr', 'raspberr', 'bran', 'flax', 'chia', 'whole grain', 'high fiber', 'high-fiber', 'spinach', 'kale', 'brussel', 'artichoke', 'pea'],
  high_fat: ['mayo', 'mayonnaise', 'oil', 'butter', 'cheese', 'nut', 'peanut butter', 'almond butter', 'avocado', 'bacon', 'cream', 'salami', 'pepperoni', 'dressing', 'tahini', 'seed', 'coconut', 'guacamole'],
  lean_protein: ['greek yogurt', 'nonfat yogurt', 'tuna', 'chicken breast', 'egg white', 'turkey breast', 'white fish', 'cod', 'tilapia', 'protein powder', 'whey', 'cottage cheese', 'shrimp', 'lean'],
  heavy_protein: ['steak', 'beef', 'ground beef', 'salmon', 'pork', 'ribs', 'sausage', 'lamb', 'duck', 'fatty'],
  high_volume_veg: ['lettuce', 'cucumber', 'tomato', 'onion', 'carrot', 'spinach', 'salad', 'pepper', 'celery', 'greens', 'kale', 'cabbage', 'broccoli', 'zucchini', 'mushroom', 'cauliflower', 'sprout'],
  liquid: ['juice', 'smoothie', 'shake', 'milk', 'soda', 'gatorade', 'broth', 'soup', 'drink', 'latte'],
};

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Classify one ingredient into a Set of digestion tags (name keywords + macro hints). */
export function classifyIngredient(ing) {
  const tags = new Set();
  const name = String(ing?.name || '').toLowerCase();
  for (const [tag, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => name.includes(w))) tags.add(tag);
  }
  // Macro hints (only when the row carries macros).
  const cal = num(ing?.calories);
  if (cal > 25) {
    const fatPct = (num(ing?.fat) * 9) / cal;
    const proPct = (num(ing?.protein) * 4) / cal;
    if (fatPct > 0.45) tags.add('high_fat');
    if (proPct > 0.45) tags.add(num(ing?.fat) * 9 / cal > 0.35 ? 'heavy_protein' : 'lean_protein');
  }
  if (num(ing?.fiber) >= 5) tags.add('high_fiber');
  return tags;
}

/** Aggregate meal-level digestion flags from macros + classified ingredients. */
export function analyzeMeal(meal) {
  const totalCal = Math.max(0, num(meal?.totalCalories));
  const fatCal = num(meal?.fat) * 9;
  const fatPct = totalCal > 0 ? fatCal / totalCal : 0;
  const fiber = num(meal?.fiber);
  const fiberPer1000 = totalCal > 0 ? fiber / (totalCal / 1000) : 0;

  const rows = Array.isArray(meal?.ingredients) ? meal.ingredients : [];
  let fastCarbG = 0, slowCarbG = 0, modCarbG = 0, vegCount = 0;
  let anyHighFat = false, anyHighFiber = false;
  for (const ing of rows) {
    const tags = classifyIngredient(ing);
    const c = num(ing.carbs);
    if (tags.has('slow_carb') || tags.has('high_fiber')) slowCarbG += c;
    else if (tags.has('fast_carb')) fastCarbG += c;
    else if (tags.has('moderate_carb')) modCarbG += c;
    if (tags.has('high_volume_veg')) vegCount += 1;
    if (tags.has('high_fat')) anyHighFat = true;
    if (tags.has('high_fiber')) anyHighFiber = true;
  }
  const carbG = fastCarbG + slowCarbG + modCarbG;
  const fastShare = carbG > 0 ? fastCarbG / carbG : 0;
  const slowShare = carbG > 0 ? slowCarbG / carbG : 0;

  return {
    totalCal,
    fatPct,
    fiber,
    highFat: fatPct >= 0.35 || (anyHighFat && fatPct >= 0.28),
    veryHighFat: fatPct >= 0.5,
    highFiber: fiber >= 8 || fiberPer1000 >= 12 || anyHighFiber,
    veryHighFiber: fiber >= 15 || fiberPer1000 >= 20,
    vegVolume: vegCount >= 2,
    fastCarbs: fastShare >= 0.5 && fatPct < 0.25 && fiber < 6,
    slowCarbs: slowShare >= 0.5,
    carbHeavy: totalCal > 0 && (num(meal?.carbs) * 4) / totalCal >= 0.5,
    proteinHeavy: num(meal?.protein) >= 40 && (num(meal?.protein) * 4) / Math.max(1, totalCal) >= 0.35,
  };
}

function baseWindow(cal) {
  if (cal < 250) return [25, 60];
  if (cal < 500) return [35, 80];
  if (cal < 800) return [60, 120];
  return [90, 180];
}

const STATUS_TITLE = {
  too_soon: 'Give it a little time',
  almost_ready: 'Almost ready',
  good_window: 'Good window to train',
  best_window: 'Best window — go',
  past_ideal: 'Past the ideal window (still fine)',
};

/**
 * Estimate the training window + recommendation. Returns:
 * { status, idealStartMinutesAfterMeal, idealEndMinutesAfterMeal, minutesSinceMeal,
 *   title, message, reasoning[], suggestions[] }
 */
export function computeTrainingWindow(meal, activity = {}) {
  const a = analyzeMeal(meal);
  const type = ACTIVITY_TYPES.some(x => x.value === activity.type) ? activity.type : 'lifting';
  const intensity = INTENSITIES.some(x => x.value === activity.intensity) ? activity.intensity : 'moderate';

  let [start, end] = baseWindow(a.totalCal);
  const reasoning = [];

  // ── Macro / digestion adjustments ──
  if (a.veryHighFat) { start += 45; end += 75; reasoning.push('very high fat, which slows digestion'); }
  else if (a.highFat) { start += 20; end += 45; reasoning.push('higher fat, so it digests slower'); }
  if (a.veryHighFiber) { start += 45; end += 75; reasoning.push('lots of fiber'); }
  else if (a.highFiber) { start += 20; end += 45; reasoning.push('higher fiber'); }
  if (a.vegVolume) { start += 15; end += 30; reasoning.push('a lot of vegetable volume'); }
  if (a.fastCarbs) { end -= 5; reasoning.push('mostly quick carbs, low fat and fiber'); }
  else if (a.slowCarbs) { start += 10; end += 20; reasoning.push('slower-digesting carbs'); }
  else if (a.carbHeavy && !a.highFat && !a.highFiber) { reasoning.push('carb-forward and light, easy to digest'); }
  if (a.proteinHeavy) { start += 10; end += 15; reasoning.push('protein-heavy'); }

  // ── Activity adjustments ──
  if (type === 'walk') {
    // A walk is fine almost immediately, regardless of the meal.
    start = clamp(start, 0, 15); end = clamp(end, 20, 45);
    reasoning.push('a walk is easy on the stomach');
  } else if (type === 'basketball' || type === 'cardio') {
    start += 25; end += 45;
    reasoning.push(`${type === 'basketball' ? 'basketball' : 'conditioning'} is bouncier, so a little more time helps`);
  } else if (type === 'rest') {
    reasoning.push('no training planned — eat and relax');
  }

  if (type !== 'walk' && type !== 'rest') {
    if (intensity === 'hard') { start += 15; end += 30; reasoning.push('hard effort'); }
    else if (intensity === 'light') { start -= 10; end -= 10; }
  }

  start = round5(clamp(start, 0, 220));
  end = round5(clamp(Math.max(end, start + 15), start + 15, 240));

  // ── Where are we relative to the window? ──
  const eaten = Number.isFinite(meal?.eatenMinutesOfDay) ? meal.eatenMinutesOfDay : null;
  const now = Number.isFinite(meal?.nowMinutesOfDay) ? meal.nowMinutesOfDay : null;
  let minutesSinceMeal = null;
  if (eaten != null && now != null) {
    minutesSinceMeal = now - eaten;
    if (minutesSinceMeal < 0) minutesSinceMeal += 24 * 60; // wrapped past midnight
    if (minutesSinceMeal > 18 * 60) minutesSinceMeal = null; // stale / not today
  }

  const range = end - start;
  let status = 'best_window';
  if (minutesSinceMeal == null) {
    status = 'best_window';
  } else if (minutesSinceMeal < start - 15) status = 'too_soon';
  else if (minutesSinceMeal < start) status = 'almost_ready';
  else if (minutesSinceMeal <= start + range * 0.33) status = 'good_window';
  else if (minutesSinceMeal <= end) status = 'best_window';
  else status = 'past_ideal';

  // ── Messages ──
  const reasonText = reasoning.length ? reasoning.slice(0, 3).join(', ') : 'balanced meal';
  let message;
  if (minutesSinceMeal == null) {
    message = `Best window is about ${start}–${end} minutes after eating.`;
  } else {
    const ago = `You ate ${minutesSinceMeal} min ago.`;
    if (status === 'too_soon') {
      const inMin = Math.max(0, start - minutesSinceMeal);
      message = `${ago} You'll likely feel best starting in about ${inMin}–${inMin + Math.max(15, Math.round(range / 2))} more minutes.`;
    } else if (status === 'almost_ready') {
      message = `${ago} Almost there — you'll be in a good window in a few minutes (best ${start}–${end} min after eating).`;
    } else if (status === 'good_window' || status === 'best_window') {
      message = `${ago} You're in a good window to train now (best ${start}–${end} min after eating).`;
    } else {
      message = `${ago} You're past the ideal ${start}–${end} min window, but you're fine to train — you may just want a small top-up if you feel low on energy.`;
    }
  }

  // ── Suggestions ──
  const suggestions = [];
  if ((type === 'basketball' || type === 'cardio') && (a.highFat || a.highFiber || a.vegVolume)) {
    suggestions.push('If you train sooner, start with lifting and save the bouncier work for later.');
  }
  if (status === 'too_soon' && (type === 'basketball' || type === 'cardio')) {
    suggestions.push('Need energy now? A small fast-carb snack (fruit, honey) settles quickly.');
  }
  if (a.totalCal >= 800 && type !== 'walk') {
    suggestions.push('This is a big meal — give it the longer end of the window before hard efforts.');
  }

  return {
    status,
    idealStartMinutesAfterMeal: start,
    idealEndMinutesAfterMeal: end,
    minutesSinceMeal,
    title: STATUS_TITLE[status] || STATUS_TITLE.best_window,
    message,
    reasoning,
    reasonText: reasonText.charAt(0).toUpperCase() + reasonText.slice(1) + '.',
    suggestions,
  };
}
