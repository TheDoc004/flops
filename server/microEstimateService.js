/**
 * microEstimateService — THE single home for micronutrient estimation.
 *
 * Given a normalized ingredient list ([{ name, amount, unit }]), estimates the
 * meal's total micronutrients via the shared aiClient and returns a structured
 * blob (or null). Reused by every logging flow (AI Logger, recipe logs, Meal
 * Builder logs) and a future recalculation pass, so the micro prompt lives in
 * exactly one place.
 */

const { callProviderJson, extractJson } = require('./aiClient');
const { MICRO_KEYS, MICRO_UNITS, buildMicrosBlob } = require('./microNutrients');

const MICRO_UNIT_HINT = MICRO_KEYS.map(k => `${k} (${MICRO_UNITS[k]})`).join(', ');

const SCHEMA = `{ "micros": { ${MICRO_KEYS.map(k => `"${k}": number`).join(', ')} }, "confidence": "high | medium | low", "notes": "string" }`;

const SYSTEM_PROMPT = `You are a micronutrient estimator for a personal nutrition app. Given a list of foods with amounts, estimate the TOTAL micronutrients across the whole list.

Rules:
- Use common food-composition knowledge to give realistic, NONZERO estimates for nutrients the foods actually contain (e.g. sweet potato has vitamin A and potassium; spinach has folate, iron, vitamin A). Do not return all zeros for foods that clearly contain nutrients.
- Nutrients and units: ${MICRO_UNIT_HINT}.
- vitamin_a_mcg is mcg RAE, NOT IU: food tables often list vitamin A in IU (an apple's "54 IU" is ~3 mcg RAE). Never copy an IU number into a mcg field.
- You may set a nutrient to 0 (or omit it) only if it is genuinely negligible for these foods.
- "confidence": "high" or "medium" when the ingredient names and amounts are clear; "low" when amounts or items are vague.
- These are rough estimates; do not give medical advice. Output no prose outside the JSON.

Output ONLY a single JSON object of this exact shape (no markdown, no code fences):
${SCHEMA}`;

/** Coerce an arbitrary ingredient list to [{ name, amount, unit }], dropping unusable rows. */
function normalizeIngredients(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const i of list) {
    const name = i && typeof i.name === 'string' ? i.name.trim() : '';
    if (!name) continue;
    const amount = i.amount != null && i.amount !== '' && Number.isFinite(Number(i.amount)) ? Number(i.amount) : (i.amount ?? null);
    out.push({ name, amount, unit: typeof i.unit === 'string' ? i.unit : '' });
    if (out.length >= 40) break;
  }
  return out;
}

function buildUser(ingredients) {
  const lines = ingredients.map(i => {
    const amt = i.amount != null && i.amount !== '' ? `${i.amount} ${i.unit || ''}`.trim() : '(amount unspecified)';
    return `- ${i.name}: ${amt}`;
  });
  return `Foods:\n${lines.join('\n')}`;
}

/**
 * Estimate micronutrients for an ingredient list.
 * @returns {Promise<object|null>} structured blob {micros,confidence,notes,version,estimatedAt}
 *   or null when there isn't enough detail / no nonzero nutrient.
 * @throws on provider/config errors (callers treat estimation as best-effort).
 */
async function estimateMicrosFromIngredients(ingredients) {
  const list = normalizeIngredients(ingredients);
  if (list.length === 0) return null; // macro-only / no usable ingredient detail
  const text = await callProviderJson({ system: SYSTEM_PROMPT, user: buildUser(list), maxTokens: 700 });
  const raw = extractJson(text);
  // buildMicrosBlob enforces "at least one nonzero" and whitelists keys.
  return buildMicrosBlob(raw?.micros, { confidence: raw?.confidence, notes: raw?.notes });
}

module.exports = { estimateMicrosFromIngredients, normalizeIngredients };
