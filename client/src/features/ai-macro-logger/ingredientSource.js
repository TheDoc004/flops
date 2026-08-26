import { macrosForLabelServingAmount, gramsFromAmount } from '@features/label-ocr';
import { QUICK_FOODS, macrosForQuickFoodAmount } from '@features/meal-logging/quickFoods';
import { isMassUnit, basisUnitFor } from '@shared/utils/unitConvert';

/**
 * Macro source hierarchy for AI-detected ingredients (highest priority first):
 *   1. Explicit macros in the CURRENT message (macroSource 'provided')
 *                                                          -> source 'provided' ("Provided in message")
 *   2. Ingredient Library  (the saved ingredient the AI named, then exact,
 *                          then fuzzy name match)          -> source 'library' ("Saved data")
 *   3. Built-in common food (fuzzy, weight-based)          -> source 'common'  ("Common data")
 *   4. AI estimate (unchanged)                              -> source 'ai'      ("Estimated")
 *
 * Tier 1 is authoritative: when the user pasted macros for an ingredient, those
 * numbers win for this log and we do NOT consult the library or any generic
 * estimate for it (the message wins even over a saved match). Tiers 2–4 only
 * borrow macros for the review; the user can still revise every value.
 */

// Unit classification is shared with the conversion layer so 'lb', 'kg' and
// 'fl oz' are read the same way here as they are at log time.
export { isMassUnit };

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

/**
 * The user's library as the AI prompt needs it: a name, the unit that
 * ingredient is measured in, and what one of those weighs when known. Most-used
 * first, so a library truncated by the server's cap keeps its best entries.
 *
 * Showing the model these units is what stops "1 filet of salmon" coming back
 * as 100 g — it can see that salmon is a thing this user counts in filets.
 */
export function libraryForPrompt(library, limit = 150) {
  return (Array.isArray(library) ? library : [])
    .filter(ing => ing && String(ing.name || '').trim())
    .slice()
    .sort((a, b) => {
      const use = (Number(b.use_count) || 0) - (Number(a.use_count) || 0);
      if (use !== 0) return use;
      return new Date(b.last_used_at || 0) - new Date(a.last_used_at || 0);
    })
    .slice(0, limit)
    .map(ing => {
      const basis = basisUnitFor(ing);
      return {
        name: String(ing.name).trim(),
        unit: basis ? basis.unit : 'serving',
        ...(basis && basis.gramsPerUnit && basis.unit !== 'g'
          ? { gramsPerUnit: basis.gramsPerUnit }
          : {}),
      };
    });
}

/**
 * The saved ingredient the AI named, resolved against the real library by exact
 * (normalized) name. The model only ever returns a name; anything that is not
 * genuinely in the library is ignored rather than trusted.
 */
export function libraryFromSavedName(savedName, library) {
  const target = norm(savedName);
  if (!target) return null;
  return (Array.isArray(library) ? library : []).find(ing => norm(ing.name) === target) || null;
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
 * { amount, unit, calories, protein, carbs, fat, gramsPerUnit, perKind }. Mirrors how
 * the saved row stores macros (per grams_per_serving for weight, per serving_quantity
 * for unit), plus the gram equivalent that lets a unit basis be logged by weight.
 */
export function basisFromLibrary(lib) {
  if (!lib) return null;
  if (lib.tracking_type === 'unit') {
    const amount = Number(lib.serving_quantity) > 0 ? Number(lib.serving_quantity) : 1;
    const gpu = Number(lib.grams_per_unit);
    return {
      amount, unit: String(lib.unit_name || 'serving'),
      calories: nn(lib.calories), protein: nn(lib.protein_g), carbs: nn(lib.carbs_g), fat: nn(lib.fat_g),
      // Carried so the row can still be logged by weight — see pseudoIngredientFromBasis.
      gramsPerUnit: Number.isFinite(gpu) && gpu > 0 ? gpu : null,
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
 * the AI-row macro shape, or null when the logged unit is not one the basis can
 * be measured in — the conversion layer, not a weight-vs-count guess, decides.
 */
export function scaleBasisToAmount(basis, quantity, unit) {
  if (!basis) return null;
  const m = macrosForLabelServingAmount(pseudoIngredientFromBasis(basis), quantity, unit);
  if (!m || !Number.isFinite(m.calories)) return null;
  return { calories: r1m(m.calories), protein: r1m(m.protein_g), carbs: r1m(m.carbs_g), fat: r1m(m.fat_g) };
}

/**
 * A basis reshaped as a saved-ingredient row, so the single scaling function —
 * and with it the whole unit-conversion layer — applies to AI rows too. A
 * non-mass basis carries the gram equivalent its library row had, which is what
 * lets a "1 filet" basis take an amount in grams.
 */
function pseudoIngredientFromBasis(basis) {
  const macros = {
    calories: basis.calories, protein_g: basis.protein,
    carbs_g: basis.carbs, fat_g: basis.fat,
  };
  if (isMassUnit(basis.unit)) {
    return { tracking_type: 'weight', grams_per_serving: gramsFromAmount(basis.amount, basis.unit), ...macros };
  }
  return {
    tracking_type: 'unit',
    unit_name: basis.unit,
    serving_quantity: basis.amount,
    grams_per_unit: basis.gramsPerUnit != null ? basis.gramsPerUnit : null,
    ...macros,
  };
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

/**
 * Best saved-library ingredient for a name: { best, score }. Same scorer the
 * freeform rows use, exposed so recipe substitutions resolve names the same way
 * ("sweet potato" → "Sweet Potato, raw") instead of demanding an exact match.
 */
export function bestLibraryMatch(name, library) {
  return bestMatch(name, Array.isArray(library) ? library : [], x => x.name);
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
 * Library macros for an AI amount, or null when the saved ingredient cannot be
 * measured in that unit. The scaling function is the whole gate now: it accepts
 * every unit the ingredient converts to ("170 g" onto a per-filet item once a
 * gram equivalent is recorded) and refuses the rest outright, instead of
 * silently reading "2 slices" as two of whatever the item is counted in.
 */
export function libraryMacrosFor(ing, quantity, unit) {
  const m = macrosForLabelServingAmount(ing, quantity, unit);
  return m && Number.isFinite(m.calories) ? m : null;
}

const r1 = x => Math.round(x * 10) / 10;

/**
 * True when a saved ingredient's computed macros (at the logged amount/unit)
 * match the user-provided macros closely enough to be the same food. A small
 * tolerance absorbs rounding (users type whole numbers; the library stores
 * precise per-serving values). Used to dedupe: provided macros that equal a
 * saved ingredient reuse it instead of creating a duplicate on recipe save.
 */
function macrosMatchProvided(ing, m) {
  const close = (a, b, floor) =>
    Math.abs(Number(a) - Number(b)) <= Math.max(floor, Math.abs(Number(b)) * 0.02);
  return (
    close(ing.calories, m.calories, 2) &&
    close(ing.protein, m.protein_g, 1) &&
    close(ing.carbs, m.carbs_g, 1) &&
    close(ing.fat, m.fat_g, 1)
  );
}

/**
 * Resolve one AI ingredient to its best macro source. Returns
 * { calories, protein, carbs, fat, source, matchedName, label_ingredient_id }.
 * matchedName is set only for a NON-exact match (so the UI can show what it used).
 */
export function resolveIngredientSource(ing, library, quickFoods = QUICK_FOODS) {
  // 1. Explicit macros provided in the current message — authoritative. The
  //    user's numbers win, EXCEPT when they identically match a saved ingredient
  //    of the same name: then prefer the saved one so we reuse it (and its id)
  //    instead of spawning a duplicate when the meal is saved as a recipe.
  if (ing.macroSource === 'provided') {
    const named = libraryFromSavedName(ing.savedIngredient, library);
    const lib = named ? { best: named, score: 1 } : bestMatch(ing.name, library, x => x.name);
    if (lib.best && lib.score >= MATCH_THRESHOLD) {
      const m = libraryMacrosFor(lib.best, ing.quantity, ing.unit);
      if (m && macrosMatchProvided(ing, m)) {
        const exact = norm(ing.name) === norm(lib.best.name);
        return {
          calories: r1(m.calories), protein: r1(m.protein_g), carbs: r1(m.carbs_g), fat: r1(m.fat_g),
          source: 'library', label_ingredient_id: lib.best.id, matchedName: exact ? null : lib.best.name,
        };
      }
    }
    return {
      calories: ing.calories, protein: ing.protein, carbs: ing.carbs, fat: ing.fat,
      source: 'provided', label_ingredient_id: undefined, matchedName: null,
    };
  }
  // 2a. The saved ingredient the model itself named. It saw the user's library
  //     and the units in it, so this beats scoring names after the fact.
  const named = libraryFromSavedName(ing.savedIngredient, library);
  if (named) {
    const m = libraryMacrosFor(named, ing.quantity, ing.unit);
    if (m) {
      const exact = norm(ing.name) === norm(named.name);
      return {
        calories: r1(m.calories), protein: r1(m.protein_g), carbs: r1(m.carbs_g), fat: r1(m.fat_g),
        source: 'library', label_ingredient_id: named.id, matchedName: exact ? null : named.name,
      };
    }
  }
  // 2b. Ingredient Library by name (exact, then fuzzy) — preferred over generic estimates.
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
