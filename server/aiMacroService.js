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
  "warnings": ["string"]
}`;

const SYSTEM_PROMPT = `You are a macro estimator for a personal nutrition app. Parse a natural meal description into structured per-ingredient estimates and calculate calories, protein, carbs, and fat (in grams).

Rules:
- Estimate macros; do not give medical, dieting, or moral advice about food.
- Distinguish cooked vs raw weights when the user states them; set "state" accordingly (use "not_applicable" for things like sauces/spices where it does not apply, "unknown" if unclear).
- Preserve brand details when the user provides them; use common nutrition estimates when brand data is missing.
- List your assumptions clearly in "assumptions".
- Flag uncertainty in "warnings" for vague inputs (e.g. "some sauce", "a splash", "a handful", "furikake", "oil spray").
- If the input is vague, still return a useful estimate but set "confidence" to "low" and warn the user to review carefully.
- "totals" must be the sum of the ingredient macros.
- Keep "summary" and notes short. Do not include any prose outside the JSON.

Output ONLY a single valid JSON object matching this exact shape (no markdown, no code fences, no commentary):
${SCHEMA_HINT}`;

function buildUserContent(description, correction) {
  let content = `Meal description:\n${description}`;
  if (correction && correction.trim()) {
    content += `\n\nCorrection / clarification to apply:\n${correction.trim()}`;
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
  };
}

/**
 * Estimate macros for a meal description.
 * @returns {Promise<object>} validated estimate matching the frontend schema.
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function estimateMacros({ description, correction } = {}) {
  const desc = str(description).trim();
  if (!desc) throw new AiResponseError('A meal description is required.');

  const text = await callProviderJson({
    system: SYSTEM_PROMPT,
    user: buildUserContent(desc, correction),
    maxTokens: 1500,
  });

  return { ...validateEstimate(extractJson(text)), provider: resolveProvider() };
}

module.exports = { estimateMacros, AiConfigError, AiProviderError, AiResponseError, AiQuotaError };
