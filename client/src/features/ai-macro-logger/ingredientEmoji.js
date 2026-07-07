/**
 * Pick a food emoji for a single ingredient so a long ingredient list can be
 * scanned by glyph instead of read word by word. Unlike mealEmoji (which picks
 * one emoji for a whole dish), this leans on granular, atomic foods — onion,
 * tomato, garlic — and falls back to a neutral utensil when nothing matches.
 *
 * Rules are ordered specific → generic so compound names resolve to their most
 * telling word (e.g. "sweet potato" → 🍠 before "potato" → 🥔).
 */
const RULES = [
  // Proteins
  [/egg white|egg\b|omelet|scramble/, '🥚'],
  [/bacon/, '🥓'],
  [/chicken|turkey|poultry/, '🍗'],
  [/steak|beef|brisket|mince|ground meat/, '🥩'],
  [/pork|\bham\b|ribs|sausage|salami|pepperoni/, '🥓'],
  [/shrimp|prawn/, '🦐'],
  [/salmon|tuna|fish|cod|tilapia|sardine|anchovy/, '🐟'],
  [/crab|lobster/, '🦀'],
  [/tofu|tempeh|seitan/, '🍢'],
  [/bean|lentil|chickpea|hummus|edamame/, '🫘'],
  // Dairy
  [/yogurt|yoghurt|kefir/, '🥛'],
  [/milk|cream(?!\s*cheese)|latte/, '🥛'],
  [/butter(?!nut)/, '🧈'],
  [/cheese|parmesan|mozzarella|cheddar|feta|ricotta/, '🧀'],
  // Grains & carbs
  [/rice|risotto/, '🍚'],
  [/oat|porridge|granola|muesli/, '🥣'],
  [/pasta|spaghetti|penne|macaroni|noodle/, '🍝'],
  [/bread|toast|bagel|bun|roll\b|pita|tortilla|wrap/, '🍞'],
  [/pancake|waffle/, '🥞'],
  [/sweet potato|yam/, '🍠'],
  [/potato|fries|hash brown/, '🥔'],
  [/quinoa|couscous|barley|cereal/, '🌾'],
  [/pretzel/, '🥨'],
  // Vegetables
  [/onion|shallot|scallion|leek/, '🧅'],
  [/garlic/, '🧄'],
  [/tomato|marinara|salsa/, '🍅'],
  [/carrot/, '🥕'],
  [/broccoli/, '🥦'],
  [/pepper|capsicum|jalapeno|chili|chilli/, '🫑'],
  [/mushroom/, '🍄'],
  [/lettuce|spinach|kale|arugula|greens|cabbage|chard/, '🥬'],
  [/cucumber|pickle|zucchini|courgette/, '🥒'],
  [/corn\b|maize/, '🌽'],
  [/eggplant|aubergine/, '🍆'],
  [/peas?\b/, '🫛'],
  // Fruit
  [/banana/, '🍌'],
  [/apple/, '🍎'],
  [/straw?berr|blueberr|raspberr|blackberr|\bberr/, '🫐'],
  [/avocado|guacamole/, '🥑'],
  [/orange|clementine|mandarin/, '🍊'],
  [/lemon|lime/, '🍋'],
  [/grape\b|grapes/, '🍇'],
  [/mango/, '🥭'],
  [/pineapple/, '🍍'],
  [/peach|nectarine|apricot/, '🍑'],
  [/melon|watermelon/, '🍉'],
  [/cherr/, '🍒'],
  [/coconut/, '🥥'],
  // Nuts, fats, extras
  [/peanut|almond|cashew|walnut|pecan|pistachio|\bnut\b|nut butter/, '🥜'],
  [/olive oil|\boil\b|olive/, '🫒'],
  [/honey|syrup|agave/, '🍯'],
  [/chocolate|cocoa|cacao/, '🍫'],
  [/sugar|sweetener/, '🍬'],
  [/salt|spice|seasoning|cinnamon|pepper corn/, '🧂'],
  [/sauce|ketchup|mayo|dressing|mustard|gravy/, '🥫'],
  [/coffee|espresso/, '☕'],
  [/water|sparkling/, '💧'],
  [/protein powder|whey|shake|smoothie/, '🥤'],
];

const FALLBACK = '🍴';

/** @returns {string} an emoji for the ingredient name, or a neutral fallback. */
export function ingredientEmoji(name) {
  const text = String(name || '').toLowerCase();
  if (!text) return FALLBACK;
  for (const [re, emoji] of RULES) {
    if (re.test(text)) return emoji;
  }
  return FALLBACK;
}
