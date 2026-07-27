/**
 * supplementEstimateService — estimate a supplement's micronutrients from just
 * its name, for products the NIH database doesn't carry (foreign brands, new
 * releases, niche powders).
 *
 * This is the ONLY supplement micro path that isn't transcribed from a real
 * label, so it is deliberately capped at MEDIUM confidence and never claims
 * "high": the caller shows it as an estimate to review, unlike a DSLD match or
 * a photo scan. See [dsldService] for the label-exact path.
 */

const { callProviderJson, extractJson, AiResponseError } = require('./aiClient');
const { MICRO_KEYS, MICRO_UNITS, buildMicrosBlob } = require('./microNutrients');

const MICRO_UNIT_HINT = MICRO_KEYS.map(k => `${k} (${MICRO_UNITS[k]})`).join(', ');

const SCHEMA = `{
  "recognized": boolean,
  "name": string,
  "dose_text": string,
  "micros": { ${MICRO_KEYS.map(k => `"${k}": number`).join(', ')} },
  "confidence": "medium | low",
  "notes": string
}`;

const SYSTEM_PROMPT = `You estimate the micronutrient content of a dietary supplement from its product name. This is an ESTIMATE from general knowledge, not a label transcription.

Rules:
- Report values for ONE typical serving of the product, and put that serving in "dose_text" (e.g. "1 capsule", "2 tablets", "1 scoop").
- Use these keys and units, converting as needed (IU->mcg for vitamins A and D): ${MICRO_UNIT_HINT}.
- Include a nutrient only if this kind of product plausibly contains a meaningful amount; use 0 or omit otherwise. A single-nutrient product (e.g. "Vitamin D3 2000 IU") should report ONLY that nutrient.
- Read dose information out of the name when present: "Vitamin D3 2000 IU" means 2000 IU = 50 mcg per serving.
- "recognized": false when the name is too vague or unfamiliar to estimate at all (then use empty micros).
- "confidence": "medium" when the product type and dose are clear from the name; "low" when you are inferring a typical formulation.
- Never report "high" — you are not reading a label.
- Give no medical advice and add no prose outside the JSON.

Output ONLY a single JSON object of this exact shape (no markdown, no code fences):
${SCHEMA}`;

/**
 * Estimate micros for a named supplement.
 * @param {string} name product name as typed
 * @returns {Promise<{recognized:boolean,name:string,dose_text:string,micros:object,confidence:string,notes:string}>}
 */
async function estimateSupplementMicros(name) {
  const query = String(name ?? '').trim();
  if (query.length < 2) throw new AiResponseError('Enter a supplement name to estimate.');

  const text = await callProviderJson({
    system: SYSTEM_PROMPT,
    user: `Estimate the per-serving micronutrients for this supplement: "${query.slice(0, 200)}"`,
    maxTokens: 700,
  });
  const raw = extractJson(text);

  // Cap at medium: an estimate must never be stored at the same confidence as
  // a transcribed label, whatever the model claims about itself.
  const confidence = raw?.confidence === 'medium' ? 'medium' : 'low';
  const blob = buildMicrosBlob(raw?.micros, { confidence, notes: raw?.notes });

  return {
    recognized: raw?.recognized !== false && !!blob,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : query.slice(0, 120),
    dose_text: typeof raw?.dose_text === 'string' ? raw.dose_text.trim().slice(0, 120) : '',
    micros: blob?.micros || {},
    confidence,
    notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 300) : '',
  };
}

module.exports = { estimateSupplementMicros };
