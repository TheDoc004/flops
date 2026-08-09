/**
 * aiMacroService — server-side macro estimator.
 *
 * Turns a natural-language meal description into a structured macro estimate.
 * Transport (provider resolution, JSON chat call, error types) lives in
 * aiClient; this module owns only the macro prompt + validation. Micronutrients
 * are estimated separately (see microEstimateService) so the prompt logic isn't
 * duplicated across features.
 */

const {
  callProviderJson,
  extractJson,
  resolveProvider,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('./aiClient');

const SCHEMA_HINT = `{
  "mealName": "string — a short name for this meal",
  "summary": "string — one short sentence describing the meal",
  "reply": "string — one short, friendly conversational sentence to the user: for a first estimate, confirm what you understood; for a correction, say exactly what you changed (and that everything else was kept)",
  "confidence": "high | medium | low",
  "ingredients": [
    {
      "name": "string",
      "quantity": number,
      "unit": "string (e.g. g, oz, cup, slice, can, piece)",
      "state": "raw | cooked | unknown | not_applicable",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "macroSource": "provided | estimated — 'provided' ONLY when the user gave explicit macros for THIS ingredient in the message; otherwise 'estimated'",
      "notes": "string — assumptions or uncertainty for this item"
    }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "mealPrep": {
    "servings": "number or null — how many servings/portions the batch is being split into, if the user stated a count; null when they did not"
  },
  "assumptions": ["string"],
  "warnings": ["string"],
  "recipeLog": {
    "recipeName": "string — the saved recipe the user is referring to, copied EXACTLY from the provided list; null if none",
    "matchConfidence": "high | medium | low",
    "modifications": [
      {
        "type": "remove | set_amount | substitute | add | scale",
        "target": "string — the recipe ingredient being changed (remove/set_amount/substitute); null otherwise",
        "quantity": "number or null — the new amount (set_amount) or amount to add",
        "unit": "string or null",
        "newName": "string or null — the replacement (substitute) or new (add) ingredient",
        "scale": "number or null — whole-recipe scale, e.g. 0.5 for half a serving",
        "calories": "number or null — for add/substitute ONLY, your estimate of THIS ingredient's calories at the stated amount",
        "protein": "number or null — for add/substitute ONLY",
        "carbs": "number or null — for add/substitute ONLY",
        "fat": "number or null — for add/substitute ONLY"
      }
    ]
  }
}`;

const SYSTEM_PROMPT = `You are a macro estimator and recipe-command interpreter for a personal nutrition app. Parse a natural meal description into structured per-ingredient estimates and calculate calories, protein, carbs, and fat (in grams).

Rules:
- Estimate macros; do not give medical, dieting, or moral advice about food.
- Distinguish cooked vs raw weights when the user states them; set "state" accordingly (use "not_applicable" for things like sauces/spices where it does not apply, "unknown" if unclear).

Explicit user-provided macros are AUTHORITATIVE — this is the single most important rule:
- When the message states macros for an ingredient — per 100 g, per serving/per stated weight, OR for the whole amount (e.g. "use 165 cal, 31g protein, 3.6g fat, 0g carbs per 100g cooked chicken"; "150 cal, 35g carbs, 3g protein per 45g dry rice"; "this sauce has 20 calories total") — you MUST use exactly those numbers. Scale a per-amount basis to the amount actually used (e.g. 165 cal / 100 g at 163 g → 269 cal; 150 cal / 45 g dry rice at 90 g → 300 cal). Carry every macro the user gave; only estimate macros they omitted (and say so in notes).
- NEVER replace user-provided macros with generic, common, brand, or database values, even if you "know" a more typical value. The user's number wins.
- Set that ingredient's "macroSource" to "provided" whenever you used the user's explicit macros for it. Set "macroSource" to "estimated" for every ingredient whose macros you estimated yourself.
- Provided macros apply ONLY to the ingredient(s) they were given for; estimate the other ingredients normally and mark them "estimated".
- A CALORIE FIGURE ALONE IS NOT A FULL MACRO SPEC. When the user states only calories for a real food (e.g. "190 calorie Rice Krispie treat", "a 100 cal granola bar", "230 calories of pasta"), they are identifying or sizing that food — they are NOT saying it contains no protein, carbs, or fat. Use their calorie number, then ESTIMATE that food's protein/carbs/fat from what the food actually is, choosing amounts that roughly reconcile with the stated calories via 4 cal/g protein, 4 cal/g carbs, 9 cal/g fat. Example: "190 calorie Rice Krispie treat" → 190 cal with roughly 1-2 g protein, 35-40 g carbs, 3-5 g fat — NEVER 0/0/0. Returning zeros for a food that obviously contains macros is a bug.
- Only report 0 for protein/carbs/fat when the food genuinely has ~none of that macro (black coffee, diet soda, most spices) or when the calories come from alcohol, which carries none of the three.
- Preserve brand details when the user provides them; use common nutrition estimates only for ingredients with NO user-provided macros and no brand data.
- Use "assumptions" ONLY for choices that are easy to miss or that materially change the macros (e.g. assumed a cooked weight, assumed the cooking oil, assumed a brand). Skip routine or obvious ones and never restate what the user plainly said. Keep each to a short phrase; often this list should be empty.
- Flag uncertainty in "warnings" for vague inputs (e.g. "some sauce", "a splash", "a handful", "furikake", "oil spray").
- If the input is vague, still return a useful estimate but set "confidence" to "low" and warn the user to review carefully.
- ALWAYS include every recognizable food or drink as an ingredient with a best-effort estimate, even when the amount or preparation is unspecified. Assume the most common default (e.g. "coffee" → one 8 oz cup of plain black coffee ≈ 2 cal; "a soda" → one 12 oz can; "toast" → 1 slice), note the assumption, and set "confidence" to low. NEVER drop a named item or return an empty "ingredients" array just because details are sparse — a single named item like "one coffee" MUST come back as one ingredient. Ignore obvious junk/filler characters (e.g. "bbbb") around a real item.
- Return an empty "ingredients" array ONLY when the message names no food or drink at all (pure gibberish or an unrelated sentence).
- "totals" must be the sum of the ingredient macros.
- Keep "summary" and notes short. Do not include any prose outside the JSON.

Meal prep awareness:
- If the description is a BATCH being cooked to eat across multiple sittings — meal prep, batch cooking, "making my lunches for the week", "this should last me a few days", "split into N containers" — set "mealPrep" to an object with "servings" = the stated number of servings/portions (integer), or null when no count was given.
- Always estimate the WHOLE batch in "ingredients" and "totals" — never divide macros by servings yourself; the app does per-serving math.
- Eating multiple servings in ONE sitting (e.g. "I ate 2 servings of chili") is NOT meal prep. A normal single meal is NOT meal prep. In both cases set "mealPrep" to null.

Revising an existing estimate — these rules override everything except explicit user-provided macros:
- When the message includes a CURRENT ESTIMATE, the user is refining it in a back-and-forth conversation. Treat that estimate as the authoritative baseline: apply ONLY the new correction, and copy every ingredient the correction does not mention UNCHANGED — same name, amount, unit, state, and macros, digit for digit.
- Do NOT re-estimate, "improve", or round unchanged ingredients, even if you would have estimated them differently from scratch.
- The ingredient(s) the correction DOES mention must be re-estimated properly from the new information — do not anchor on their old numbers. E.g. switching 100 g cooked rice to 90 g dry weight roughly TRIPLES its calories (dry rice ≈ 350-365 cal/100 g), because dry grains absorb water when cooked.
- Earlier corrections listed in the message are already reflected in the current estimate. NEVER undo or re-litigate them — the new correction is additive on top of them.
- If the new correction contradicts an earlier one, the newest instruction wins for the part it covers.
- In "reply", state specifically what you changed this turn (e.g. "Switched the rice to 90 g dry weight — everything else is unchanged.").

Saved-recipe awareness:
- The user may reference one of their SAVED recipes (e.g. "log my Egg Toast Wombo Combo", "log my bagel recipe but skip the banana"). Their saved recipes — each with its ingredient list — are provided below (may be empty).
- If the description refers to a saved recipe, set "recipeLog.recipeName" to the EXACT matching name from the provided list, set "matchConfidence", and capture any requested changes in "recipeLog.modifications". Do NOT invent or recalculate that recipe's ingredients/macros — the app loads the real saved recipe and applies the changes itself.
- For each modification, set "target" to the EXACT ingredient name from THAT recipe's ingredient list (map the user's words to the real ingredient — e.g. "toast" → the recipe's bread ingredient, "yogurt" → the recipe's Greek yogurt). Use type "remove" for skip/without/no, "set_amount" for "use 245g X"/"make it N", "substitute" (with newName) for "use X instead of Y", "scale" (with a numeric "scale", e.g. 0.5 for half) for whole-recipe portions, and "add" ONLY for an ingredient that is NOT already in the recipe.
- For "add" and "substitute" modifications, ALSO estimate that single ingredient's calories/protein/carbs/fat for the stated quantity/unit (e.g. add 70g blueberries → ~40 cal, ~0.5 protein, ~10 carbs, ~0 fat). If the user gives only a calorie amount (e.g. "20 calories of BBQ sauce"), use that calorie number and still estimate that food's protein/carbs/fat so they roughly reconcile with it (BBQ sauce at 20 cal → ~5 g carbs, ~0 protein, ~0 fat) — do not default the macros to zero. These per-ingredient macros are used only for added/substituted items, never to recalc the saved recipe.
- Entries tagged [MEAL PREP — …] are batches the user cooked earlier and is eating across days; the tag shows how many servings remain and how long ago it was made. When the user says they ate / want to log (a serving of) a meal prep — "log my chicken prep", "had one of my meal prep lunches", "eating my leftovers from the chicken and rice I made" — match it via recipeLog exactly like a saved recipe. For N servings of a meal prep, use a single "scale" modification with scale = N (the app converts that to a serving count and tracks the remaining servings itself). Do not re-estimate its macros.
- Only use a name that appears in the provided list. If you are unsure which saved recipe is meant, set "matchConfidence" to "low". If the description is a normal freeform meal (not a saved recipe), set "recipeLog" to null.
- When the user CORRECTS a saved-recipe log, "modifications" must list EVERY change from the whole conversation — the earlier ones plus the new one — because the app re-applies them to the original saved recipe from scratch each time. Returning only the newest change would silently undo the earlier ones. (This is the opposite of the freeform rule above, where earlier corrections are already baked into the current estimate.)
- A substitute or add is NOT limited to ingredients already in the recipe: if the user swaps in something they've never used there ("sweet potato instead of the toast"), still emit the substitute with "newName" and your macro estimate for it. The app resolves the name against their saved ingredients.
- Either way, still fill "ingredients"/"totals" with a best-effort estimate (used only as a fallback when no saved recipe matches).

Output ONLY a single valid JSON object matching this exact shape (no markdown, no code fences, no commentary):
${SCHEMA_HINT}`;

/** One line per ingredient of the estimate being revised, so the model can copy unchanged rows verbatim. */
function describeCurrentEstimate(est) {
  if (!est || typeof est !== 'object' || !Array.isArray(est.ingredients) || !est.ingredients.length) return '';
  const lines = est.ingredients.map(i => {
    const qty = Number.isFinite(Number(i.quantity)) && Number(i.quantity) > 0 ? `${Number(i.quantity)} ${str(i.unit).trim()}`.trim() : str(i.unit).trim();
    const state = STATES.has(i.state) && i.state !== 'unknown' && i.state !== 'not_applicable' ? `, ${i.state}` : '';
    const src = i.macroSource === 'provided' ? ' [user-provided macros — authoritative]' : '';
    return `- ${str(i.name, 'Item').trim()}${qty ? ` (${qty}${state})` : ''}: ${num(i.calories)} cal, ${num(i.protein)}g protein, ${num(i.carbs)}g carbs, ${num(i.fat)}g fat${src}`;
  });
  const name = str(est.mealName).trim();
  return `${name ? `${name}\n` : ''}${lines.join('\n')}`;
}

function buildUserContent(description, corrections, currentEstimate, recipes) {
  let content = `Meal description:\n${description}`;
  const history = (Array.isArray(corrections) ? corrections : [])
    .map(c => str(c).trim())
    .filter(Boolean);
  const latest = history.pop();
  if (latest) {
    const baseline = describeCurrentEstimate(currentEstimate);
    if (baseline) {
      content += `\n\nCURRENT ESTIMATE — the baseline being revised. Copy every ingredient the new correction does not mention EXACTLY as listed here:\n${baseline}`;
    }
    if (history.length) {
      content += `\n\nEarlier corrections, already reflected in the current estimate — keep all of them in effect:\n${history.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
    }
    content += `\n\nNEW correction to apply now:\n${latest}\n\nIMPORTANT: The baseline numbers above are now WRONG for every ingredient this correction mentions — re-estimate those ingredients completely from scratch using the corrected information (amount, unit, state, AND all four macros; remember dry/raw vs cooked weight changes macros drastically). Copy every ingredient the correction does not mention from the baseline exactly.`;
  }
  const list = Array.isArray(recipes)
    ? recipes.filter(r => r && typeof r.name === 'string' && r.name.trim())
    : [];
  if (list.length) {
    const lines = list.map(r => {
      const ings = Array.isArray(r.ingredients)
        ? r.ingredients.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
        : [];
      let prepTag = '';
      if (r.prep && typeof r.prep === 'object' && r.prep.remainingServings != null) {
        const of = r.prep.totalServings != null ? ` of ${r.prep.totalServings}` : '';
        const age = r.prep.madeDaysAgo == null
          ? ''
          : r.prep.madeDaysAgo === 0 ? ', made today'
          : r.prep.madeDaysAgo === 1 ? ', made yesterday'
          : `, made ${r.prep.madeDaysAgo} days ago`;
        prepTag = ` [MEAL PREP — ${r.prep.remainingServings}${of} servings left${age}]`;
      }
      return ings.length ? `- ${r.name}${prepTag} (ingredients: ${ings.join(', ')})` : `- ${r.name}${prepTag}`;
    });
    content += `\n\nThe user's saved recipes — match recipeLog.recipeName ONLY against these exact names, and set each modification "target" to the EXACT ingredient name listed for that recipe:\n${lines.join('\n')}`;
  } else {
    content += `\n\n(The user has no saved recipes — set recipeLog to null.)`;
  }
  return content;
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10) / 10;
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v));
}

const STATES = new Set(['raw', 'cooked', 'unknown', 'not_applicable']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const MOD_TYPES = new Set(['remove', 'set_amount', 'substitute', 'add', 'scale']);

/** Validate the optional recipe-command block. Returns null when not a recipe reference. */
function validateRecipeLog(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const recipeName = str(raw.recipeName).trim();
  if (!recipeName) return null;
  const matchConfidence = CONFIDENCES.has(raw.matchConfidence) ? raw.matchConfidence : 'low';
  const macro = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 10) / 10 : null);
  const modifications = (Array.isArray(raw.modifications) ? raw.modifications : [])
    .map(m => ({
      type: MOD_TYPES.has(m?.type) ? m.type : null,
      target: str(m?.target).trim() || null,
      quantity: Number.isFinite(Number(m?.quantity)) ? Number(m.quantity) : null,
      unit: str(m?.unit).trim() || null,
      newName: str(m?.newName).trim() || null,
      scale: Number.isFinite(Number(m?.scale)) && Number(m.scale) > 0 ? Number(m.scale) : null,
      // Per-ingredient macro estimate for add/substitute (null = not provided).
      calories: macro(m?.calories),
      protein: macro(m?.protein),
      carbs: macro(m?.carbs),
      fat: macro(m?.fat),
    }))
    .filter(m => m.type)
    .slice(0, 20);
  return { recipeName, matchConfidence, modifications };
}

/** Validate the optional meal-prep block. Returns null when not a batch. */
function validateMealPrep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = Number(raw.servings);
  return { servings: Number.isInteger(s) && s >= 2 && s <= 50 ? s : null };
}

/** Coerce arbitrary AI output into the strict shape the frontend expects. */
/**
 * Calories a row's macros actually account for (Atwater 4/4/9).
 * Alcohol carries 7 cal/g and none of the three, so a drink legitimately
 * lands far below its stated calories — hence a warning, never an auto-fix.
 */
function macroCalories({ protein, carbs, fat }) {
  return (Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9;
}

/**
 * Rows whose macros can't explain their calories. The common cause is the
 * model reading "190 calorie Rice Krispie treat" as a full macro spec and
 * returning 190/0/0/0. Deterministic backstop for the prompt rule, since a
 * prompt alone can drift.
 */
function unreconciledRows(ingredients) {
  return ingredients.filter(i => {
    if (i.calories < 25) return false; // black coffee, spices, seasonings
    return macroCalories(i) < i.calories * 0.5;
  });
}

function validateEstimate(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new AiResponseError('AI response was not an object.');
  }
  const ingredientsRaw = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  const ingredients = ingredientsRaw.map(i => ({
    name: str(i?.name, 'Item').trim() || 'Item',
    quantity: Number.isFinite(Number(i?.quantity)) ? Number(i.quantity) : 0,
    unit: str(i?.unit).trim(),
    state: STATES.has(i?.state) ? i.state : 'unknown',
    calories: num(i?.calories),
    protein: num(i?.protein),
    carbs: num(i?.carbs),
    fat: num(i?.fat),
    macroSource: i?.macroSource === 'provided' ? 'provided' : 'estimated',
    notes: str(i?.notes).trim(),
  }));

  // Totals: trust the model if present and sane, else recompute from ingredients.
  const sum = ingredients.reduce(
    (acc, x) => ({
      calories: acc.calories + x.calories,
      protein: acc.protein + x.protein,
      carbs: acc.carbs + x.carbs,
      fat: acc.fat + x.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const totals = {
    calories: num(raw?.totals?.calories ?? sum.calories),
    protein: num(raw?.totals?.protein ?? sum.protein),
    carbs: num(raw?.totals?.carbs ?? sum.carbs),
    fat: num(raw?.totals?.fat ?? sum.fat),
  };

  const toStringArray = v =>
    (Array.isArray(v) ? v : []).map(x => str(x).trim()).filter(Boolean);

  const warnings = toStringArray(raw.warnings);
  const unreconciled = unreconciledRows(ingredients);
  if (unreconciled.length > 0) {
    const names = unreconciled.map(i => i.name).slice(0, 3).join(', ');
    warnings.push(
      `Check the macros on ${names}${unreconciled.length > 3 ? ' and others' : ''} — the protein/carbs/fat don't add up to the calories shown${unreconciled.some(i => /beer|wine|vodka|whiskey|rum|gin|tequila|cocktail|alcohol|liquor/i.test(i.name)) ? ' (expected for alcohol)' : ''}.`
    );
  }

  return {
    mealName: str(raw.mealName, 'Meal').trim() || 'Meal',
    summary: str(raw.summary).trim(),
    reply: str(raw.reply).trim(),
    confidence: CONFIDENCES.has(raw.confidence) ? raw.confidence : 'medium',
    ingredients,
    totals,
    assumptions: toStringArray(raw.assumptions),
    warnings,
    recipeLog: validateRecipeLog(raw.recipeLog),
    mealPrep: validateMealPrep(raw.mealPrep),
  };
}

/**
 * Estimate macros for a meal description.
 * @returns {Promise<object>} validated estimate matching the frontend schema.
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function estimateMacros({ description, corrections, currentEstimate, recipes } = {}) {
  const desc = str(description).trim();
  if (!desc) throw new AiResponseError('A meal description is required.');

  const text = await callProviderJson({
    system: SYSTEM_PROMPT,
    user: buildUserContent(desc, corrections, currentEstimate, recipes),
    maxTokens: 1500,
  });

  return { ...validateEstimate(extractJson(text)), provider: resolveProvider() };
}

module.exports = { estimateMacros, unreconciledRows, macroCalories, AiConfigError, AiProviderError, AiResponseError, AiQuotaError };
