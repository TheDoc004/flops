import { macrosForLabelServingAmount, gramsFromAmount } from '@features/label-ocr';
import { QUICK_FOODS, macrosForQuickFoodAmount } from '@features/meal-logging/quickFoods';

/**
 * Macro source hierarchy for AI-detected ingredients (highest priority first):
 *   1. Explicit macros in the CURRENT message (macroSource 'provided')
 *                                                          -> source 'provided' ("Provided in message")
 *   2. Ingredient Library  (exact, then fuzzy name match)  -> source 'library' ("Saved data")
 *   3. Built-in common food (fuzzy, weight-based)          -> source 'common'  ("Common data")
 *   4. AI estimate (unchanged)                              -> source 'ai'      ("Estimated")
 *
 * Tier 1 is authoritative: when the user pasted macros for an ingredient, those
 * numbers win for this log and we do NOT consult the library or any generic
 * estimate for it (the message wins even over a saved match). Tiers 2–4 only
 * borrow macros for the review; the user can still revise every value.
 */

const MASS_UNIT = /^(g|gram|grams|oz|ounce|ounces)$/;
export const isMassUnit = u => MASS_UNIT.test(String(u || '').toLowerCase());

// Preparation / quality words that shouldn't block a match.
const FILLER = new Set([
  'plain', 'raw', 'fresh', 'cooked', 'organic', 'natural', 'unsweetened',
  'low', 'reduced', 'of', 'the', 'a', 'an', 'with', 'and',
]);

// State-changing preparation words: unlike a brand or variety, these change
// what the food IS. A generic mention ("banana") must not auto-match a saved
// item whose name declares a different state ("Frozen banana") — but the
// reverse convenience ("honey" → "Clover honey") should keep working.
const STATE_MODIFIERS = new Set([
  'frozen', 'freeze', 'dried', 'dehydrated', 'canned', 'jarred', 'pickled',
  'smoked', 'cured', 'candied', 'breaded', 'battered', 'fried', 'powdered',
  'instant', 'concentrate', 'concentrated',
]);

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const contentTokens = s => norm(s).split(' ').filter(Boolean).map(singular).filter(t => !FILLER.has(t));

/** True when either name carries a state modifier the other lacks. */
function stateMismatch(As, Cs) {
  for (const t of As) if (STATE_MODIFIERS.has(t) && !Cs.has(t)) return true;
  for (const t of Cs) if (STATE_MODIFIERS.has(t) && !As.has(t)) return true;
  return false;
}

/**
 * Name similarity in [0,1]. 1 = exact (normalized); 0.9 = one name's content
 * tokens are a subset of the other ("honey" ⊂ "clover honey"); otherwise the
 * Jaccard overlap of content tokens.
 *
 * Two exceptions keep the subset bonus from over-matching:
 * - It only applies when the subset covers the superset's HEAD noun (last
 *   content token — what the food IS). "honey" ⊂ "clover honey" qualifies
 *   (honey is the head); "onion" ⊂ "onion bagels" does not (bagel is the
 *   head — an onion is not a bagel).
 * - A state-modifier mismatch (one name says "frozen"/"dried"/… and the other
 *   doesn't) caps the score at 0.5 — below MATCH_THRESHOLD.
 * In both cases the item can still rank as a suggestion, never auto-selected.
 */
export function nameScore(aiName, candName) {
  const a = norm(aiName), c = norm(candName);
  if (!a || !c) return 0;
  if (a === c) return 1;
  const A = contentTokens(aiName), C = contentTokens(candName);
  if (!A.length || !C.length) return 0;
  const As = new Set(A), Cs = new Set(C);
  const mismatch = stateMismatch(As, Cs);
  if (!mismatch) {
    const headA = A[A.length - 1], headC = C[C.length - 1];
    if (A.every(t => Cs.has(t)) && As.has(headC)) return 0.9; // A ⊂ C, C's head covered
    if (C.every(t => As.has(t)) && Cs.has(headA)) return 0.9; // C ⊂ A, A's head covered
  }
  let inter = 0;
  for (const t of As) if (Cs.has(t)) inter += 1;
  const uni = new Set([...As, ...Cs]).size;
  const jaccard = uni ? inter / uni : 0;
  return mismatch ? Math.min(jaccard, 0.5) : jaccard;
}

export const MATCH_THRESHOLD = 0.6;

const r1m = x => Math.round(x * 10) / 10;

/** Saved-library ingredients ranked by likely match to a name (best first), full list. */
export function rankedLibrary(name, library) {
  const list = Array.isArray(library) ? library : [];
  return list
    .map(ing => ({ ing, score: nameScore(name, ing.name) }))
    .sort((a, b) => b.score - a.score || String(a.ing.name).localeCompare(String(b.ing.name)))
    .map(x => x.ing);
}

/** How many saved ingredients strongly match a name (for the "multiple matches" hint). */
export function strongMatchCount(name, library) {
  return (Array.isArray(library) ? library : []).filter(ing => nameScore(name, ing.name) >= MATCH_THRESHOLD).length;
}

/** Macros for a chosen saved ingredient at an amount/unit, in the AI-row shape, or null. */
export function macrosFromLibrary(libIng, quantity, unit) {
  const m = libraryMacrosFor(libIng, quantity, unit);
  if (!m) return null;
  return { calories: r1m(m.calories), protein: r1m(m.protein_g), carbs: r1m(m.carbs_g), fat: r1m(m.fat_g) };
}

const nn = v => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };

/**
 * Likely saved matches for a parsed name — best first, limited (default 8). Only
 * returns scored (>0) candidates so the dropdown isn't the whole library.
 */
export function likelyLibraryMatches(name, library, limit = 8) {
  return rankedLibrary(name, library)
    .filter(ing => nameScore(name, ing.name) > 0)
    .slice(0, limit);
}

/** Substring search across the full library (for the "search the full library" field). */
export function searchLibrary(query, library) {
  const q = String(query || '').toLowerCase().trim();
  const list = Array.isArray(library) ? library : [];
  if (!q) return [];
  return list
    .filter(ing => String(ing.name || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The per-serving "nutrition basis" of a saved ingredient, in the editable shape
 * { amount, unit, calories, protein, carbs, fat, perKind }. Mirrors how the saved
 * row stores macros (per grams_per_serving for weight, per serving_quantity for unit).
 */
export function basisFromLibrary(lib) {
  if (!lib) return null;
  if (lib.tracking_type === 'unit') {
    const amount = Number(lib.serving_quantity) > 0 ? Number(lib.serving_quantity) : 1;
    return {
      amount, unit: String(lib.unit_name || 'serving'),
      calories: nn(lib.calories), protein: nn(lib.protein_g), carbs: nn(lib.carbs_g), fat: nn(lib.fat_g),
      perKind: 'serving',
    };
  }
  const grams = Number(lib.grams_per_serving) > 0 ? Number(lib.grams_per_serving) : 100;
  return {
    amount: grams, unit: 'g',
    calories: nn(lib.calories), protein: nn(lib.protein_g), carbs: nn(lib.carbs_g), fat: nn(lib.fat_g),
    perKind: 'serving',
  };
}

/**
 * Scale a basis { amount, unit, cal, p, c, f } to a logged amount/unit. Returns
 * the AI-row macro shape, or null if the basis unit and logged unit are
 * incompatible (weight ↔ count) — same guard used for saved ingredients.
 */
export function scaleBasisToAmount(basis, quantity, unit) {
  if (!basis) return null;
  const weightBasis = isMassUnit(basis.unit);
  const massLogged = isMassUnit(unit);
  if (weightBasis !== massLogged) return null;
  const pseudo = weightBasis
    ? { tracking_type: 'weight', grams_per_serving: gramsFromAmount(basis.amount, basis.unit), calories: basis.calories, protein_g: basis.protein, carbs_g: basis.carbs, fat_g: basis.fat }
    : { tracking_type: 'unit', serving_quantity: basis.amount, calories: basis.calories, protein_g: basis.protein, carbs_g: basis.carbs, fat_g: basis.fat };
  const m = macrosForLabelServingAmount(pseudo, quantity, massLogged ? unit : 'unit');
  if (!m || !Number.isFinite(m.calories)) return null;
  return { calories: r1m(m.calories), protein: r1m(m.protein_g), carbs: r1m(m.carbs_g), fat: r1m(m.fat_g) };
}

/**
 * The basis to show/edit for a resolved row (after its final macros are set).
 *  - library match  → the saved ingredient's per-serving basis
 *  - weight AI/common → per 100 g (back-derived from the final macros)
 *  - everything else  → per 1 unit (back-derived from the final macros)
 */
export function deriveBasis(row, library) {
  if (row.source === 'library' && row.label_ingredient_id != null) {
    const lib = (Array.isArray(library) ? library : []).find(x => Number(x.id) === Number(row.label_ingredient_id));
    const b = basisFromLibrary(lib);
    if (b) return b;
  }
  if (isMassUnit(row.unit)) {
    const grams = gramsFromAmount(row.quantity, row.unit);
    if (grams && grams > 0) {
      const f = 100 / grams;
      return { amount: 100, unit: 'g', calories: r1m(nn(row.calories) * f), protein: r1m(nn(row.protein) * f), carbs: r1m(nn(row.carbs) * f), fat: r1m(nn(row.fat) * f), perKind: '100g' };
    }
  }
  const q = Number(row.quantity) > 0 ? Number(row.quantity) : 1;
  return { amount: 1, unit: row.unit || 'serving', calories: r1m(nn(row.calories) / q), protein: r1m(nn(row.protein) / q), carbs: r1m(nn(row.carbs) / q), fat: r1m(nn(row.fat) / q), perKind: 'unit' };
}

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
  // 1. Explicit macros provided in the current message — authoritative. Lock the
  //    user's numbers and skip every generic/library lookup for this ingredient.
  if (ing.macroSource === 'provided') {
    return {
      calories: ing.calories, protein: ing.protein, carbs: ing.carbs, fat: ing.fat,
      source: 'provided', label_ingredient_id: undefined, matchedName: null,
    };
  }
  // 2. Ingredient Library (exact, then fuzzy) — preferred over generic estimates.
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
  // 3. Built-in common food (weight-based only).
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
  // 4. AI estimate (unchanged).
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
    const row = {
      ...ing,
      calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
      source: r.source, label_ingredient_id: r.label_ingredient_id, matchedName: r.matchedName,
    };
    return { ...row, basis: deriveBasis(row, library) };
  });
  return { ...est, ingredients };
}
