/**
 * supplementLabelService — reads a photo of a Supplement Facts / nutrition panel
 * and extracts structured, PER-SERVING data via the shared aiClient's vision
 * support. Unlike food micro estimation, these values are transcribed from the
 * label (exact), so the caller stores them at high confidence. One home for the
 * supplement-label prompt + validation.
 */

const {
  callProviderJson,
  extractJson,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('./aiClient');
const { parseServingText } = require('./supplementDose');
const { MICRO_KEYS, MICRO_UNITS, buildMicrosBlob } = require('./microNutrients');

const MICRO_UNIT_HINT = MICRO_KEYS.map(k => `${k} (${MICRO_UNITS[k]})`).join(', ');

const SCHEMA = `{
  "name": string,
  "dose_text": string,
  "macros": { "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number },
  "micros": { ${MICRO_KEYS.map(k => `"${k}": number`).join(', ')} },
  "confidence": "high | medium | low",
  "notes": string
}`;

const SYSTEM_PROMPT = `You read the "Supplement Facts" or "Nutrition Facts" panel in a photo and transcribe it into JSON. This is transcription, not estimation — only report what is printed on the label.

Rules:
- Report values for ONE serving (the label's serving size / "Amount Per Serving" column).
- Use the ABSOLUTE amount printed (e.g. "Vitamin D 25 mcg"), never the "% Daily Value" number.
- Convert to these keys and units, converting units if the label differs (e.g. IU→mcg for vitamin D/A, g→mg): ${MICRO_UNIT_HINT}.
- Include a nutrient only if it appears on the label with a real amount; omit or set 0 for anything not listed.
- "name": the product name if visible, else "". "dose_text": the serving size text (e.g. "2 capsules", "1 scoop"), else "".
- "macros": include calories/protein/carbs/fat only if the panel lists them; use 0 for any not shown.
- "confidence": "high" when the panel is clearly legible, "low" when the image is blurry, cropped, or hard to read.
- Give no medical advice and add no prose outside the JSON.

Output ONLY a single JSON object of this exact shape (no markdown, no code fences):
${SCHEMA}`;

const USER_PROMPT =
  'Transcribe the supplement/nutrition label in this image into the required JSON. Per serving; absolute amounts, not % Daily Value.';

const nn = v => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : 0;
};

/** Keep macros only when at least one value is present; else null. */
function shapeMacros(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const macros = {
    calories: nn(raw.calories),
    protein_g: nn(raw.protein_g),
    carbs_g: nn(raw.carbs_g),
    fat_g: nn(raw.fat_g),
  };
  return Object.values(macros).some(v => v > 0) ? macros : null;
}

/**
 * Scan a supplement label image → { name, dose_text, macros, micros, confidence, notes }.
 * `micros` is a flat { key: amount } object (possibly empty); `macros` is null
 * when the panel shows none. Values are label-exact for the UI to review.
 * @param {{ imageDataUrl: string }} args base64 data URL of the (cropped) photo
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function scanSupplementLabel({ imageDataUrl }) {
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    throw new AiResponseError('No image provided to scan.');
  }
  const text = await callProviderJson({
    system: SYSTEM_PROMPT,
    user: USER_PROMPT,
    maxTokens: 900,
    imageDataUrl,
  });
  const raw = extractJson(text);
  // buildMicrosBlob whitelists keys, clamps, and drops all-zero → null.
  const blob = buildMicrosBlob(raw?.micros, { confidence: raw?.confidence, notes: raw?.notes });
  return {
    name: typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : '',
    dose_text: typeof raw?.dose_text === 'string' ? raw.dose_text.trim().slice(0, 120) : '',
    // Same structured serving the other capture paths return, parsed from the
    // label's own wording so the client can offer "you take N of these".
    ...(() => {
      const parsed = parseServingText(typeof raw?.dose_text === 'string' ? raw.dose_text : '');
      return { serving_qty: parsed?.qty ?? 1, serving_unit: parsed?.unit ?? 'serving' };
    })(),
    macros: shapeMacros(raw?.macros),
    micros: blob?.micros || {},
    confidence: ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'low',
    notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 300) : '',
  };
}

module.exports = {
  scanSupplementLabel,
  shapeMacros,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
};
