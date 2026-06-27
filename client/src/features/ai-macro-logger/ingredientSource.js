import { macrosForLabelServingAmount } from '@features/label-ocr';
import { QUICK_FOODS, macrosForQuickFoodAmount } from '@features/meal-logging/quickFoods';

/**
 * Macro source hierarchy for AI-detected ingredients:
 *   1. Ingredient Library  (exact, then fuzzy name match)  -> source 'library' ("Saved data")
 *   2. Built-in common food (fuzzy, weight-based)          -> source 'common'  ("Common data")
 *   3. AI estimate (unchanged)                              -> source 'ai'      ("AI estimate")
 *
 * Saved/library data is always preferred over generic estimates. Matching never
 * creates or mutates saved ingredients — it only borrows their macros for the
 * review, and the user can still revise every value.
 */

const MASS_UNIT = /^(g|gram|grams|oz|ounce|ounces)$/;
export const isMassUnit = u => MASS_UNIT.test(String(u || '').toLowerCase());

// Preparation / quality words that shouldn't block a match.
const FILLER = new Set([
  'plain', 'raw', 'fresh', 'cooked', 'organic', 'natural', 'unsweetened',
  'low', 'reduced', 'of', 'the', 'a', 'an', 'with', 'and',
]);

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const contentTokens = s => norm(s).split(' ').filter(Boolean).map(singular).filter(t => !FILLER.has(t));

/**
 * Name similarity in [0,1]. 1 = exact (normalized); 0.9 = one name's content
 * tokens are a subset of the other ("honey" ⊂ "clover honey"); otherwise the
 * Jaccard overlap of content tokens.
 */
export function nameScore(aiName, candName) {
  const a = norm(aiName), c = norm(candName);
  if (!a || !c) return 0;
  if (a === c) return 1;
  const A = contentTokens(aiName), C = contentTokens(candName);
  if (!A.length || !C.length) return 0;
  const As = new Set(A), Cs = new Set(C);
  if (A.every(t => Cs.has(t)) || C.every(t => As.has(t))) return 0.9;
  let inter = 0;
  for (const t of As) if (Cs.has(t)) inter += 1;
  const uni = new Set([...As, ...Cs]).size;
  return uni ? inter / uni : 0;
}

const MATCH_THRESHOLD = 0.6;

/** Best candidate by name score; ties go to the most-used (use_count) item. */
function bestMatch(name, candidates, getName) {
  let best = null, bestScore = 0;
  for (const c of candidates || []) {
    const sc = nameScore(name, getName(c));
    if (sc > bestScore || (sc === bestScore && sc > 0 && best && (Number(c.use_count) || 0) > (Number(best.use_count) || 0))) {
      bestScore = sc; best = c;
    }
  }
  return { best, score: bestScore };
}

/**
 * Library macros for an AI amount, ONLY when the unit is compatible with the
 * saved ingredient's tracking type (else null — we won't mis-scale "1 tbsp" onto
 * a grams-per-serving item or "170 g" onto a per-unit item).
 */
export function libraryMacrosFor(ing, quantity, unit) {
  const unitTracked = ing.tracking_type === 'unit';
  const mass = isMassUnit(unit);
  if (unitTracked && mass) return null;
  if (!unitTracked && !mass) return null;
  const m = macrosForLabelServingAmount(ing, quantity, mass ? unit : 'unit');
  return m && Number.isFinite(m.calories) ? m : null;
}

const r1 = x => Math.round(x * 10) / 10;

/**
 * Resolve one AI ingredient to its best macro source. Returns
 * { calories, protein, carbs, fat, source, matchedName, label_ingredient_id }.
 * matchedName is set only for a NON-exact match (so the UI can show what it used).
 */
export function resolveIngredientSource(ing, library, quickFoods = QUICK_FOODS) {
  // 1. Ingredient Library (exact, then fuzzy) — preferred.
  const lib = bestMatch(ing.name, library, x => x.name);
  if (lib.best && lib.score >= MATCH_THRESHOLD) {
    const m = libraryMacrosFor(lib.best, ing.quantity, ing.unit);
    if (m) {
      const exact = norm(ing.name) === norm(lib.best.name);
      return {
        calories: r1(m.calories), protein: r1(m.protein_g), carbs: r1(m.carbs_g), fat: r1(m.fat_g),
        source: 'library', label_ingredient_id: lib.best.id, matchedName: exact ? null : lib.best.name,
      };
    }
  }
  // 2. Built-in common food (weight-based only).
  if (isMassUnit(ing.unit)) {
    const cf = bestMatch(ing.name, quickFoods, x => x.name);
    if (cf.best && cf.score >= MATCH_THRESHOLD) {
      const m = macrosForQuickFoodAmount(cf.best, ing.quantity, ing.unit);
      if (m) {
        const exact = norm(ing.name) === norm(cf.best.name);
        return {
          calories: r1(m.calories), protein: r1(m.protein_g), carbs: r1(m.carbs_g), fat: r1(m.fat_g),
          source: 'common', matchedName: exact ? null : cf.best.name,
        };
      }
    }
  }
  // 3. AI estimate (unchanged).
  return {
    calories: ing.calories, protein: ing.protein, carbs: ing.carbs, fat: ing.fat,
    source: 'ai', label_ingredient_id: undefined, matchedName: null,
  };
}

/** Apply the source hierarchy to every ingredient in an estimate. Pure. */
export function enrichEstimate(est, library, quickFoods = QUICK_FOODS) {
  if (!est) return est;
  const ingredients = est.ingredients.map(ing => {
    const r = resolveIngredientSource(ing, library, quickFoods);
    return {
      ...ing,
      calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
      source: r.source, label_ingredient_id: r.label_ingredient_id, matchedName: r.matchedName,
    };
  });
  return { ...est, ingredients };
}
