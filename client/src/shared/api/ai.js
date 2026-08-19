import { apiFetch } from './base';

/**
 * Ask the server-side AI to estimate macros for a natural-language meal.
 * @param {{ description: string, corrections?: string[], currentEstimate?: object, recipes?: {name: string, ingredients?: string[]}[] }} payload
 *   corrections is the full revision history (oldest → newest) and
 *   currentEstimate is the estimate being revised — together they let the AI
 *   apply only the newest correction without undoing earlier ones. recipes lets
 *   the AI recognize a referenced saved recipe and map modification targets to
 *   that recipe's real ingredient names.
 * @returns {Promise<object>} validated estimate (mealName, summary, reply, confidence,
 *   ingredients[], totals, assumptions[], warnings[], recipeLog|null).
 */
/**
 * Send a recorded voice note to the server for speech-to-text.
 * @param {Blob} blob raw audio from MediaRecorder (webm on Chrome/Android, mp4 on iOS)
 * @returns {Promise<string>} the transcript ('' when no speech was detected)
 */
export async function transcribeAudio(blob) {
  const res = await apiFetch('/api/ai/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to transcribe audio.');
  }
  const data = await res.json();
  return typeof data?.text === 'string' ? data.text : '';
}

export async function estimateMacros({ description, corrections, currentEstimate, recipes } = {}) {
  const res = await apiFetch('/api/ai/macro-estimate', {
    method: 'POST',
    body: JSON.stringify({ description, corrections, currentEstimate, recipes }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to estimate macros.');
  }
  return res.json();
}

/**
 * Ask AI for substitute ingredients from the user's library.
 * @param {{ ingredient: object, library: object[], limit?: number }} payload
 */
export async function suggestSubstitutes({ ingredient, library, limit } = {}) {
  const res = await apiFetch('/api/ai/suggest-substitutes', {
    method: 'POST',
    body: JSON.stringify({ ingredient, library, limit }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to suggest substitutes.');
  }
  return res.json();
}
