/**
 * Pick a food emoji that fits a meal. The title is checked first — it's the
 * user's own description, so it should win ("Protein pancakes" → 🥞 even if
 * eggs dominate the ingredients). Ingredient names are the fallback, then a
 * neutral plate.
 *
 * Rules are ordered specific → generic: dish names beat single ingredients,
 * and meal-of-day words (breakfast/lunch) sit last so they only catch titles
 * with no stronger signal.
 */
const RULES = [
  // Named dishes
  [/burrito|wrap/, '🌯'],
  [/taco/, '🌮'],
  [/pizza/, '🍕'],
  [/burger/, '🍔'],
  [/sandwich|\bsub\b|\bblt\b/, '🥪'],
  [/sushi|poke/, '🍣'],
  [/ramen|noodle|pho\b/, '🍜'],
  [/pasta|spaghetti|penne|lasagn|mac and cheese|macaroni/, '🍝'],
  [/curry/, '🍛'],
  [/soup|stew|chili/, '🍲'],
  [/salad/, '🥗'],
  [/pancake|waffle|french toast|crepe/, '🥞'],
  [/oat|porridge|granola|cereal|muesli|parfait/, '🥣'],
  [/smoothie|shake/, '🥤'],
  [/coffee|latte|espresso/, '☕'],
  [/cookie|brownie|cake|donut|dessert/, '🍪'],
  [/chocolate/, '🍫'],
  // Proteins
  [/egg|omelet|scramble|frittata/, '🍳'],
  [/bacon/, '🥓'],
  [/chicken|turkey|poultry/, '🍗'],
  [/steak|beef|brisket/, '🥩'],
  [/pork|\bham\b|ribs/, '🍖'],
  [/shrimp|prawn/, '🦐'],
  [/salmon|tuna|fish|cod|tilapia/, '🐟'],
  [/tofu|tempeh/, '🥡'],
  [/yogurt/, '🥛'],
  [/cheese/, '🧀'],
  // Carbs & produce
  [/rice|risotto/, '🍚'],
  [/potato|fries/, '🥔'],
  [/bread|toast|bagel|croissant|roll\b/, '🍞'],
  [/banana/, '🍌'],
  [/apple/, '🍎'],
  [/berr/, '🫐'],
  [/avocado/, '🥑'],
  [/corn\b/, '🌽'],
  // Generic meal words — last resort within a pass
  [/breakfast|brunch/, '🍳'],
  [/bowl/, '🥣'],
  [/snack/, '🍎'],
];

const FALLBACK = '🍽️';

function match(text) {
  if (!text) return null;
  for (const [re, emoji] of RULES) {
    if (re.test(text)) return emoji;
  }
  return null;
}

export function mealEmoji(name, ingredientNames = []) {
  const fromTitle = match(String(name || '').toLowerCase());
  if (fromTitle) return fromTitle;
  const joined = ingredientNames.map((n) => String(n || '').toLowerCase()).join(' ');
  return match(joined) || FALLBACK;
}
