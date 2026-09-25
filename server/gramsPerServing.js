/**
 * grams_per_serving must be a real serving mass, not a placeholder.
 * Values like 1 were historically stored when the weight was unknown, which
 * made per-100g derivation explode (cal_per_serving * 100 / 1).
 *
 * Floor: below MIN_GRAMS_PER_SERVING we treat the value as unknown (null for
 * derivation; rejected on write). Pure spices/oils can still use >= 3g servings
 * or stay null and use unit tracking.
 */

const MIN_GRAMS_PER_SERVING = 3;

function isUsableGramsPerServing(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_GRAMS_PER_SERVING;
}

/**
 * Normalize an optional grams_per_serving from a write payload.
 * @returns {{ value: number|null } | { error: string }}
 */
function normalizeGramsPerServingInput(raw, { required = false } = {}) {
  if (raw === null || raw === undefined || raw === '') {
    if (required) return { error: 'grams_per_serving is required' };
    return { value: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { error: 'grams_per_serving must be a positive number, or null if unknown' };
  }
  if (n < MIN_GRAMS_PER_SERVING) {
    return {
      error:
        `grams_per_serving must be at least ${MIN_GRAMS_PER_SERVING}g (got ${n}). ` +
        `Tiny placeholders like 1 are not allowed — leave null and use unit tracking, ` +
        `or enter the real label serving weight.`,
    };
  }
  return { value: n };
}

module.exports = {
  MIN_GRAMS_PER_SERVING,
  isUsableGramsPerServing,
  normalizeGramsPerServingInput,
};
