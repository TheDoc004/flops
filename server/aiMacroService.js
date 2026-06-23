/**
 * aiMacroService — server-side macro estimator.
 *
 * Turns a natural-language meal description into a structured macro estimate.
 * Provider-agnostic: uses OpenAI or Anthropic depending on which API key is set
 * (AI_PROVIDER overrides). The API key is read here, server-side only, and is
 * never sent to the frontend.
 *
 * No SDK dependency — calls each provider's REST API with the built-in fetch
 * (Node 18+). Output is validated against a fixed schema before it leaves here.
 */

class AiConfigError extends Error {} // no usable API key configured -> 503
class AiProviderError extends Error {} // provider call failed -> 502
class AiResponseError extends Error {} // provider returned unusable output -> 502
class AiQuotaError extends Error {} // provider account out of quota / billing not set up -> 402

// Quota / billing signatures across providers (OpenAI "insufficient_quota",
// Anthropic "credit balance is too low", generic billing/payment language).
const QUOTA_RE = /insufficient_quota|exceeded your current quota|credit balance is too low|billing|payment required|out of credits|quota/i;

function classifyProviderError(status, detail) {
  if (status === 402 || QUOTA_RE.test(String(detail || ''))) {
    return new AiQuotaError(
      "The AI provider says the account is out of quota or billing isn't set up. Add credits / check the provider's billing settings, then try again."
    );
  }
  return new AiProviderError(`AI service returned ${status}. ${String(detail).slice(0, 300)}`);
}

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

function resolveProvider() {
  const explicit = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (explicit === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function buildUserContent(description, correction) {
  let content = `Meal description:\n${description}`;
  if (correction && correction.trim()) {
    content += `\n\nCorrection / clarification to apply:\n${correction.trim()}`;
  }
  return content;
}

async function callOpenAI({ description, correction }) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserContent(description, correction) },
        ],
      }),
    });
  } catch (e) {
    throw new AiProviderError(`Could not reach the AI service: ${e.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw classifyProviderError(res.status, detail);
  }
  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AiResponseError('AI service returned an empty response.');
  return text;
}

async function callAnthropic({ description, correction }) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(description, correction) }],
      }),
    });
  } catch (e) {
    throw new AiProviderError(`Could not reach the AI service: ${e.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw classifyProviderError(res.status, detail);
  }
  const data = await res.json().catch(() => null);
  const text = Array.isArray(data?.content)
    ? data.content.filter(b => b?.type === 'text').map(b => b.text).join('')
    : null;
  if (!text) throw new AiResponseError('AI service returned an empty response.');
  return text;
}

/** Pull the JSON object out of a model response (tolerates stray prose / code fences). */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AiResponseError('AI response did not contain valid JSON.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiResponseError('AI response was not valid JSON.');
  }
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
 * @throws {AiConfigError|AiProviderError|AiResponseError}
 */
async function estimateMacros({ description, correction } = {}) {
  const desc = str(description).trim();
  if (!desc) throw new AiResponseError('A meal description is required.');

  const provider = resolveProvider();
  if (!provider) {
    throw new AiConfigError(
      'AI macro estimation is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY on the server.'
    );
  }

  const text =
    provider === 'anthropic'
      ? await callAnthropic({ description: desc, correction })
      : await callOpenAI({ description: desc, correction });

  return { ...validateEstimate(extractJson(text)), provider };
}

module.exports = { estimateMacros, AiConfigError, AiProviderError, AiResponseError, AiQuotaError };
