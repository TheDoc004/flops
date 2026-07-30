/**
 * Server mirror of the v1 micronutrient keys + units. Keep in sync with
 * client/src/shared/config/microNutrients.js. Used to (a) whitelist incoming
 * micro estimates before storing, and (b) tell the AI which nutrients to
 * estimate. Keys encode their unit suffix: _g grams, _mg milligrams, _mcg micrograms.
 */
const MICRO_UNITS = {
  // Vitamins
  vitamin_a_mcg: 'mcg',
  thiamin_mg: 'mg',
  riboflavin_mg: 'mg',
  niacin_mg: 'mg',
  pantothenic_acid_mg: 'mg',
  vitamin_b6_mg: 'mg',
  biotin_mcg: 'mcg',
  folate_mcg: 'mcg',
  vitamin_b12_mcg: 'mcg',
  vitamin_c_mg: 'mg',
  vitamin_d_mcg: 'mcg',
  vitamin_e_mg: 'mg',
  vitamin_k_mcg: 'mcg',
  // Minerals
  calcium_mg: 'mg',
  copper_mg: 'mg',
  iodine_mcg: 'mcg',
  iron_mg: 'mg',
  magnesium_mg: 'mg',
  manganese_mg: 'mg',
  phosphorus_mg: 'mg',
  potassium_mg: 'mg',
  selenium_mcg: 'mcg',
  sodium_mg: 'mg',
  zinc_mg: 'mg',
  // Omega-3s
  omega3_ala_g: 'g',
  omega3_epa_mg: 'mg',
  omega3_dha_mg: 'mg',
  // Other
  fiber_g: 'g',
  choline_mg: 'mg',
};

const MICRO_KEYS = Object.keys(MICRO_UNITS);
const MICRO_ESTIMATE_VERSION = 'v2'; // v2 = expanded key set (2026-07-30)

/**
 * Build the structured micros blob to store on a log entry, or null. Whitelists
 * to known keys, clamps to finite non-negatives, and — crucially — returns null
 * unless at least one nutrient is > 0 (an empty/all-zero object is not a real
 * estimate). Single validation path shared by the log route and the estimator.
 */
function buildMicrosBlob(microsRaw, { confidence, notes } = {}) {
  if (!microsRaw || typeof microsRaw !== 'object') return null;
  const micros = {};
  for (const k of MICRO_KEYS) {
    const v = Number(microsRaw[k]);
    if (Number.isFinite(v) && v >= 0) micros[k] = Math.round(v * 100) / 100;
  }
  if (!Object.values(micros).some(v => v > 0)) return null;
  const conf = ['low', 'medium', 'high'].includes(confidence) ? confidence : 'low';
  const safeNotes = notes != null ? String(notes).slice(0, 500) : '';
  return { micros, confidence: conf, notes: safeNotes, version: MICRO_ESTIMATE_VERSION, estimatedAt: new Date().toISOString() };
}

module.exports = { MICRO_KEYS, MICRO_UNITS, MICRO_ESTIMATE_VERSION, buildMicrosBlob };
