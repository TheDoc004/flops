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
      "notes": "string — assumptions or uncertainty for this item"
    }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number },
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
        "scale": "number or null — whole-recipe scale, e.g. 0.5 for half a serving"
      }
    ]
  }
}`;

const SYSTEM_PROMPT = `You are a macro estimator and recipe-command interpreter for a personal nutrition app. Parse a natural meal description into structured per-ingredient estimates and calculate calories, protein, carbs, and fat (in grams).

Rules:
- Estimate macros; do not give medical, dieting, or moral advice about food.
- Distinguish cooked vs raw weights when the user states them; set "state" accordingly (use "not_applicable" for things like sauces/spices where it does not apply, "unknown" if unclear).
- Preserve brand details when the user provides them; use common nutrition estimates when brand data is missing.
- List your assumptions clearly in "assumptions".
- Flag uncertainty in "warnings" for vague inputs (e.g. "some sauce", "a splash", "a handful", "furikake", "oil spray").
- If the input is vague, still return a useful estimate but set "confidence" to "low" and warn the user to review carefully.
- "totals" must be the sum of the ingredient macros.
- Keep "summary" and notes short. Do not include any prose outside the JSON.

Saved-recipe awareness:
- The user may reference one of their SAVED recipes (e.g. "log my Egg Toast Wombo Combo", "log my bagel recipe but skip the banana"). A list of their saved recipe names is provided (it may be empty).
- If the description refers to a saved recipe, set "recipeLog.recipeName" to the EXACT matching name from the provided list, set "matchConfidence", and capture any requested changes in "recipeLog.modifications". Do NOT invent or recalculate that recipe's ingredients — the app loads the real saved recipe and applies the changes itself.
- Only use a name that appears in the provided list. If you are unsure which saved recipe is meant, set "matchConfidence" to "low". If the description is a normal freeform meal (not a saved recipe), set "recipeLog" to null.
- Either way, still fill "ingredients"/"totals" with a best-effort estimate (used only as a fallback when no saved recipe matches).

Output ONLY a single valid JSON object matching this exact shape (no markdown, no code fences, no commentary):
${SCHEMA_HINT}`;

function buildUserContent(description, correction, recipeNames) {
  let content = `Meal description:\n${description}`;
  if (correction && correction.trim()) {
    content += `\n\nCorrection / clarification to apply:\n${correction.trim()}`;
  }
  const names = Array.isArray(recipeNames) ? recipeNames.filter(x => typeof x === 'string' && x.trim()) : [];
  content += names.length
    ? `\n\nSaved recipe names (match recipeLog.recipeName ONLY against these exact names):\n${names.map(x => `- ${x}`).join('\n')}`
    : `\n\n(The user has no saved recipes — set recipeLog to null.)`;
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
  const modifications = (Array.isArray(raw.modifications) ? raw.modifications : [])
    .map(m => ({
      type: MOD_TYPES.has(m?.type) ? m.type : null,
      target: str(m?.target).trim() || null,
      quantity: Number.isFinite(Number(m?.quantity)) ? Number(m.quantity) : null,
      unit: str(m?.unit).trim() || null,
      newName: str(m?.newName).trim() || null,
      scale: Number.isFinite(Number(m?.scale)) && Number(m.scale) > 0 ? Number(m.scale) : null,
    }))
    .filter(m => m.type)
    .slice(0, 20);
  return { recipeName, matchConfidence, modifications };
}

/** Coerce arbitrary AI output into the strict shape the frontend expects. */
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

  return {
    mealName: str(raw.mealName, 'Meal').trim() || 'Meal',
    summary: str(raw.summary).trim(),
    confidence: CONFIDENCES.has(raw.confidence) ? raw.confidence : 'medium',
    ingredients,
    totals,
    assumptions: toStringArray(raw.assumptions),
    warnings: toStringArray(raw.warnings),
    recipeLog: validateRecipeLog(raw.recipeLog),
  };
}

/**
 * Estimate macros for a meal description.
 * @returns {Promise<object>} validated estimate matching the frontend schema.
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function estimateMacros({ description, correction, recipeNames } = {}) {
  const desc = str(description).trim();
  if (!desc) throw new AiResponseError('A meal description is required.');

  const text = await callProviderJson({
    system: SYSTEM_PROMPT,
    user: buildUserContent(desc, correction, recipeNames),
    maxTokens: 1500,
  });

  return { ...validateEstimate(extractJson(text)), provider: resolveProvider() };
}

module.exports = { estimateMacros, AiConfigError, AiProviderError, AiResponseError, AiQuotaError };
