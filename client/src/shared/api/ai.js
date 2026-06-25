import { apiUrl } from './base';

/**
 * Ask the server-side AI to estimate macros for a natural-language meal.
 * @param {{ description: string, correction?: string, recipeNames?: string[] }} payload
 *   recipeNames lets the AI recognize when the user is referencing a saved recipe.
 * @returns {Promise<object>} validated estimate (mealName, summary, confidence,
 *   ingredients[], totals, assumptions[], warnings[], recipeLog|null).
 */
export async function estimateMacros({ description, correction, recipeNames } = {}) {
  const res = await fetch(apiUrl('/api/ai/macro-estimate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, correction, recipeNames }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to estimate macros.');
  }
  return res.json();
}
