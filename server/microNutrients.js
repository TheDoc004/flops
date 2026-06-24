/**
 * Server mirror of the v1 micronutrient keys + units. Keep in sync with
 * client/src/shared/config/microNutrients.js. Used to (a) whitelist incoming
 * micro estimates before storing, and (b) tell the AI which nutrients to
 * estimate. Keys encode their unit suffix: _g grams, _mg milligrams, _mcg micrograms.
 */
const MICRO_UNITS = {
  fiber_g: 'g',
  sodium_mg: 'mg',
  potassium_mg: 'mg',
  calcium_mg: 'mg',
  iron_mg: 'mg',
  magnesium_mg: 'mg',
  zinc_mg: 'mg',
  vitamin_a_mcg: 'mcg',
  vitamin_c_mg: 'mg',
  vitamin_d_mcg: 'mcg',
  folate_mcg: 'mcg',
  vitamin_b12_mcg: 'mcg',
};

const MICRO_KEYS = Object.keys(MICRO_UNITS);
const MICRO_ESTIMATE_VERSION = 'v1';

module.exports = { MICRO_KEYS, MICRO_UNITS, MICRO_ESTIMATE_VERSION };
