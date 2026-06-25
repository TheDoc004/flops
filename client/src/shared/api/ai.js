import { apiUrl } from './base';

/**
 * Ask the server-side AI to estimate macros for a natural-language meal.
 * @param {{ description: string, correction?: string, recipes?: {name: string, ingredients?: string[]}[] }} payload
 *   recipes lets the AI recognize a referenced saved recipe and map modification
 *   targets to that recipe's real ingredient names.
 * @returns {Promise<object>} validated estimate (mealName, summary, confidence,
 *   ingredients[], totals, assumptions[], warnings[], recipeLog|null).
 */
export async function estimateMacros({ description, correction, recipes } = {}) {
  const res = await fetch(apiUrl('/api/ai/macro-estimate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, correction, recipes }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to estimate macros.');
  }
  return res.json();
}
