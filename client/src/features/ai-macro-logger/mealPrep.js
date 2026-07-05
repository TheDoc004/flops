/**
 * mealPrep — deterministic meal-prep detection for the AI logger.
 *
 * First layer of a three-layer detection system, so meal-prep mode never
 * hinges on the model alone:
 *   1. This parser — explicit phrasing ("split into 4", "meal prep", "makes
 *      5 portions"), regex-based, unit-tested. An explicit serving count found
 *      here OVERRIDES whatever the model returned.
 *   2. The model — estimate.mealPrep from the server, for fuzzy phrasing regex
 *      can't catch ("cooked a big batch for my lunches this week").
 *   3. The review UI's manual "meal prep" toggle — the human backstop.
 */

const WORD_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const PORTION = '(?:servings?|portions?|meals?|containers?|boxes?|tupperwares?|lunches|dinners)';

const KEYWORD_RE = /\b(?:meal[\s-]?prep\w*|batch[\s-]?cook\w*|food[\s-]?prep\w*|prepp(?:ed|ing))\b/i;

// Phrasings that state the split explicitly. Batch verbs are required so that
// amounts EATEN never read as a batch ("I ate 2 servings of chili").
const COUNT_RES = [
  // "split (it) (up) into 4", "divided this into four portions"
  new RegExp(`\\b(?:split|divid\\w*|portion\\w*|separat\\w*|break\\w*)\\b[^.,;!?]{0,24}?\\binto\\s+${NUM}\\b`, 'i'),
  // "into 4 servings/containers/meals/tupperwares"
  new RegExp(`\\binto\\s+${NUM}\\s+${PORTION}`, 'i'),
  // "makes 5 servings", "should give me 6 lunches", "getting 4 meals out of it"
  new RegExp(`\\b(?:make|makes|making|yield\\w*|gives?|giving|get|gets|getting)\\s+(?:me\\s+)?(?:about\\s+|around\\s+|roughly\\s+)?${NUM}\\s+${PORTION}`, 'i'),
];

// Bare "N servings" — only trusted when a meal-prep keyword is ALSO present.
const BARE_COUNT_RE = new RegExp(`\\b${NUM}\\s+${PORTION}\\b`, 'i');

const toCount = tok => {
  const n = WORD_NUM[String(tok).toLowerCase()] ?? Number(tok);
  return Number.isInteger(n) && n >= 2 && n <= 50 ? n : null;
};

/**
 * @param {string} text - the meal description as typed/spoken
 * @returns {{ isMealPrep: boolean, servings: number|null }}
 */
export function detectMealPrep(text) {
  const s = String(text || '');
  const keyword = KEYWORD_RE.test(s);
  let servings = null;
  for (const re of COUNT_RES) {
    const m = s.match(re);
    if (m) {
      servings = toCount(m[1]);
      if (servings != null) break;
    }
  }
  if (servings == null && keyword) {
    const m = s.match(BARE_COUNT_RE);
    if (m) servings = toCount(m[1]);
  }
  return { isMealPrep: keyword || servings != null, servings };
}

/**
 * Merge the deterministic parse with the model's mealPrep field.
 * Precedence: explicit count in the description > model's count > count
 * unknown (UI asks); prep-ness is true if EITHER layer says so.
 *
 * @param {string} description
 * @param {{servings: number|null}|null|undefined} aiMealPrep - estimate.mealPrep from the server
 * @returns {{ isMealPrep: boolean, servings: number|null }}
 */
export function reconcileMealPrep(description, aiMealPrep) {
  const detected = detectMealPrep(description);
  if (detected.servings != null) {
    return { isMealPrep: true, servings: detected.servings };
  }
  const aiSaysPrep = aiMealPrep != null && typeof aiMealPrep === 'object';
  const aiServings = Number(aiMealPrep?.servings);
  const aiCount = Number.isInteger(aiServings) && aiServings >= 2 && aiServings <= 50 ? aiServings : null;
  if (detected.isMealPrep || aiSaysPrep) {
    return { isMealPrep: true, servings: aiCount };
  }
  return { isMealPrep: false, servings: null };
}
