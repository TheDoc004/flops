/**
 * Suggest substitute ingredients from the user's library via AI.
 * Returns only ids that appear in the provided library snapshot.
 */

const {
  callProviderJson,
  extractJson,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('./aiClient');

const SYSTEM = `You help a nutrition app suggest substitute ingredients.
Given one current ingredient and a list of foods from the user's personal library, pick the closest substitutes from THAT LIST ONLY.
Prefer same food category (bread→bread, yogurt→yogurt), similar use (toast toppings, cooking oils), and similar tracking type when possible.
Respond with JSON only:
{ "suggestions": [ { "label_ingredient_id": <number>, "reason": "<short>" } ] }
Use only ids from the library list. Return at most the requested limit. If nothing fits, return { "suggestions": [] }.`;

async function suggestSubstitutes({ ingredient, library, limit = 5 } = {}) {
  const lim = Math.min(10, Math.max(1, Number(limit) || 5));
  const lib = Array.isArray(library) ? library.slice(0, 80) : [];
  const validIds = new Set(lib.map(x => Number(x.id)).filter(n => Number.isInteger(n) && n > 0));

  const user = JSON.stringify({
    current: ingredient && typeof ingredient === 'object'
      ? {
          name: String(ingredient.name || '').slice(0, 120),
          brand_name: ingredient.brand_name ? String(ingredient.brand_name).slice(0, 80) : undefined,
          base_label: ingredient.base_label ? String(ingredient.base_label).slice(0, 80) : undefined,
          tracking_type: ingredient.tracking_type || undefined,
        }
      : { name: 'unknown' },
    library: lib.map(x => ({
      id: Number(x.id),
      name: String(x.name || '').slice(0, 120),
      brand_name: x.brand_name ? String(x.brand_name).slice(0, 80) : undefined,
      base_label: x.base_label ? String(x.base_label).slice(0, 80) : undefined,
    })),
    limit: lim,
  });

  const text = await callProviderJson({ system: SYSTEM, user, maxTokens: 600 });
  const parsed = extractJson(text);
  const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const seen = new Set();
  const suggestions = [];
  for (const s of raw) {
    const id = Number(s?.label_ingredient_id ?? s?.id);
    if (!Number.isInteger(id) || id <= 0 || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    suggestions.push({
      label_ingredient_id: id,
      reason: typeof s.reason === 'string' ? s.reason.slice(0, 160) : undefined,
    });
    if (suggestions.length >= lim) break;
  }
  return { suggestions };
}

module.exports = {
  suggestSubstitutes,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
};
