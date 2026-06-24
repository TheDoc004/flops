/**
 * Micronutrient target config — single source of truth for the Flops micro
 * tracking foundation. v1 ships one "adult male" RDA-style profile; the shape
 * (PROFILES map + per-nutrient defs) is built so other age/sex/life-stage
 * profiles can be added later without redesigning the system.
 *
 * Targets are general RDA/AI references, not medical advice. Upper limits are
 * only set where a real tolerable upper intake level exists; nutrients without
 * one must never be flagged as "too high".
 */

export const MICRO_CATEGORIES = [
  { key: 'vitamin', label: 'Vitamins' },
  { key: 'mineral', label: 'Minerals' },
  { key: 'other', label: 'Other' },
];

// key, name, category, unit, target, upperLimit?, watch?, sourceType, description
const ADULT_MALE = [
  { key: 'fiber_g',         name: 'Fiber',        category: 'other',   unit: 'g',   target: 38,   sourceType: 'RDA', description: 'Supports digestion and fullness.' },
  { key: 'sodium_mg',       name: 'Sodium',       category: 'mineral', unit: 'mg',  target: 2300, upperLimit: 2300, watch: true, sourceType: 'RDA', description: 'A watch nutrient — most people get plenty.' },
  { key: 'potassium_mg',    name: 'Potassium',    category: 'mineral', unit: 'mg',  target: 3400, sourceType: 'RDA', description: 'Helps balance fluids and blood pressure.' },
  { key: 'calcium_mg',      name: 'Calcium',      category: 'mineral', unit: 'mg',  target: 1000, upperLimit: 2500, sourceType: 'RDA', description: 'Bone strength.' },
  { key: 'iron_mg',         name: 'Iron',         category: 'mineral', unit: 'mg',  target: 8,    upperLimit: 45,   sourceType: 'RDA', description: 'Carries oxygen in the blood.' },
  { key: 'magnesium_mg',    name: 'Magnesium',    category: 'mineral', unit: 'mg',  target: 420,  sourceType: 'RDA', description: 'Muscle and nerve function.' },
  { key: 'zinc_mg',         name: 'Zinc',         category: 'mineral', unit: 'mg',  target: 11,   upperLimit: 40,   sourceType: 'RDA', description: 'Immune support.' },
  { key: 'vitamin_a_mcg',   name: 'Vitamin A',    category: 'vitamin', unit: 'mcg', target: 900,  upperLimit: 3000, sourceType: 'RDA', description: 'Vision and immune health.' },
  { key: 'vitamin_c_mg',    name: 'Vitamin C',    category: 'vitamin', unit: 'mg',  target: 90,   upperLimit: 2000, sourceType: 'RDA', description: 'Antioxidant; supports immunity.' },
  { key: 'vitamin_d_mcg',   name: 'Vitamin D',    category: 'vitamin', unit: 'mcg', target: 20,   upperLimit: 100,  sourceType: 'RDA', description: 'Bone health and immunity.' },
  { key: 'folate_mcg',      name: 'Folate',       category: 'vitamin', unit: 'mcg', target: 400,  upperLimit: 1000, sourceType: 'RDA', description: 'Cell growth and repair.' },
  { key: 'vitamin_b12_mcg', name: 'Vitamin B12',  category: 'vitamin', unit: 'mcg', target: 2.4,  sourceType: 'RDA', description: 'Nerve function and energy.' },
];

const PROFILES = {
  adult_male: { id: 'adult_male', label: 'Adult male (default)', nutrients: ADULT_MALE },
};

export const DEFAULT_PROFILE_ID = 'adult_male';

export function getMicroProfile(id = DEFAULT_PROFILE_ID) {
  return PROFILES[id] || PROFILES[DEFAULT_PROFILE_ID];
}

/** Ordered nutrient definitions for the active (default) profile. */
export const MICRO_NUTRIENTS = getMicroProfile().nutrients.map((n, i) => ({ order: i, ...n }));
export const MICRO_KEYS = MICRO_NUTRIENTS.map(n => n.key);
export const MICRO_BY_KEY = Object.fromEntries(MICRO_NUTRIENTS.map(n => [n.key, n]));

/** Nutrients grouped by category, in display order — for the daily panel. */
export const MICRO_GROUPS = MICRO_CATEGORIES
  .map(c => ({ ...c, nutrients: MICRO_NUTRIENTS.filter(n => n.category === c.key) }))
  .filter(g => g.nutrients.length > 0);

export const MICRO_ESTIMATE_NOTE =
  'Micronutrients are estimates and may vary by brand, food database, cooking method, and portion accuracy.';
