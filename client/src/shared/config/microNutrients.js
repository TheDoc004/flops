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
  { key: 'lipid', label: 'Omega-3s' },
];

// key, name, category, unit, target, upperLimit?, watch?, sourceType, description
//
// v2 (2026-07-30) widened this from 12 keys to the full label panel — B-complex,
// E/K, trace minerals, choline, and the omega-3s (what fish oil actually
// provides). Keys still encode their unit suffix; expansion is additive, so
// blobs stored under v1 simply carry fewer keys.
const ADULT_MALE = [
  // ── Vitamins ──
  { key: 'vitamin_a_mcg',   name: 'Vitamin A',    category: 'vitamin', unit: 'mcg', target: 900,  upperLimit: 3000, sourceType: 'RDA', description: 'Vision and immune health.' },
  { key: 'thiamin_mg',      name: 'B1 (Thiamin)', category: 'vitamin', unit: 'mg',  target: 1.2,  sourceType: 'RDA', description: 'Turns food into energy.' },
  { key: 'riboflavin_mg',   name: 'B2 (Riboflavin)', category: 'vitamin', unit: 'mg', target: 1.3, sourceType: 'RDA', description: 'Energy production and cell function.' },
  { key: 'niacin_mg',       name: 'B3 (Niacin)',  category: 'vitamin', unit: 'mg',  target: 16,   upperLimit: 35,   sourceType: 'RDA', description: 'Metabolism and nervous system.' },
  { key: 'pantothenic_acid_mg', name: 'B5 (Pantothenic acid)', category: 'vitamin', unit: 'mg', target: 5, sourceType: 'AI', description: 'Hormone and energy synthesis.' },
  { key: 'vitamin_b6_mg',   name: 'B6',           category: 'vitamin', unit: 'mg',  target: 1.3,  upperLimit: 100,  sourceType: 'RDA', description: 'Protein metabolism and brain function.' },
  { key: 'biotin_mcg',      name: 'B7 (Biotin)',  category: 'vitamin', unit: 'mcg', target: 30,   sourceType: 'AI', description: 'Hair, skin, and nail health.' },
  { key: 'folate_mcg',      name: 'Folate',       category: 'vitamin', unit: 'mcg', target: 400,  upperLimit: 1000, sourceType: 'RDA', description: 'Cell growth and repair.' },
  { key: 'vitamin_b12_mcg', name: 'Vitamin B12',  category: 'vitamin', unit: 'mcg', target: 2.4,  sourceType: 'RDA', description: 'Nerve function and energy.' },
  { key: 'vitamin_c_mg',    name: 'Vitamin C',    category: 'vitamin', unit: 'mg',  target: 90,   upperLimit: 2000, sourceType: 'RDA', description: 'Antioxidant; supports immunity.' },
  { key: 'vitamin_d_mcg',   name: 'Vitamin D',    category: 'vitamin', unit: 'mcg', target: 20,   upperLimit: 100,  sourceType: 'RDA', description: 'Bone health and immunity.' },
  { key: 'vitamin_e_mg',    name: 'Vitamin E',    category: 'vitamin', unit: 'mg',  target: 15,   upperLimit: 1000, sourceType: 'RDA', description: 'Antioxidant; protects cells.' },
  { key: 'vitamin_k_mcg',   name: 'Vitamin K',    category: 'vitamin', unit: 'mcg', target: 120,  sourceType: 'AI', description: 'Blood clotting and bone health.' },
  // ── Minerals ──
  { key: 'calcium_mg',      name: 'Calcium',      category: 'mineral', unit: 'mg',  target: 1000, upperLimit: 2500, sourceType: 'RDA', description: 'Bone strength.' },
  { key: 'copper_mg',       name: 'Copper',       category: 'mineral', unit: 'mg',  target: 0.9,  upperLimit: 10,   sourceType: 'RDA', description: 'Iron transport and connective tissue.' },
  { key: 'iodine_mcg',      name: 'Iodine',       category: 'mineral', unit: 'mcg', target: 150,  upperLimit: 1100, sourceType: 'RDA', description: 'Thyroid hormone production.' },
  { key: 'iron_mg',         name: 'Iron',         category: 'mineral', unit: 'mg',  target: 8,    upperLimit: 45,   sourceType: 'RDA', description: 'Carries oxygen in the blood.' },
  { key: 'magnesium_mg',    name: 'Magnesium',    category: 'mineral', unit: 'mg',  target: 420,  sourceType: 'RDA', description: 'Muscle and nerve function.' },
  { key: 'manganese_mg',    name: 'Manganese',    category: 'mineral', unit: 'mg',  target: 2.3,  upperLimit: 11,   sourceType: 'AI', description: 'Bone formation and metabolism.' },
  { key: 'phosphorus_mg',   name: 'Phosphorus',   category: 'mineral', unit: 'mg',  target: 700,  upperLimit: 4000, sourceType: 'RDA', description: 'Bone structure and energy storage.' },
  { key: 'potassium_mg',    name: 'Potassium',    category: 'mineral', unit: 'mg',  target: 3400, sourceType: 'RDA', description: 'Helps balance fluids and blood pressure.' },
  { key: 'selenium_mcg',    name: 'Selenium',     category: 'mineral', unit: 'mcg', target: 55,   upperLimit: 400,  sourceType: 'RDA', description: 'Antioxidant defense and thyroid.' },
  { key: 'sodium_mg',       name: 'Sodium',       category: 'mineral', unit: 'mg',  target: 2300, upperLimit: 2300, watch: true, sourceType: 'RDA', description: 'A watch nutrient — most people get plenty.' },
  { key: 'zinc_mg',         name: 'Zinc',         category: 'mineral', unit: 'mg',  target: 11,   upperLimit: 40,   sourceType: 'RDA', description: 'Immune support.' },
  // Display-only: Fiber and choline used to be a two-row Other group.
  { key: 'fiber_g',         name: 'Fiber',        category: 'mineral', unit: 'g',   target: 38,   sourceType: 'RDA', description: 'Supports digestion and fullness.' },
  { key: 'choline_mg',      name: 'Choline',      category: 'mineral', unit: 'mg',  target: 550,  upperLimit: 3500, sourceType: 'AI', description: 'Liver, muscle, and brain function.' },
  // ── Omega-3s ── (EPA/DHA have no official DRI; 250 mg each is a common
  // general reference for regular fish/fish-oil intake, not medical advice.)
  { key: 'omega3_ala_g',    name: 'ALA',          category: 'lipid',   unit: 'g',   target: 1.6,  sourceType: 'AI', description: 'Plant omega-3 (flax, chia, walnuts).' },
  { key: 'omega3_epa_mg',   name: 'EPA',          category: 'lipid',   unit: 'mg',  target: 250,  sourceType: 'AI', description: 'Marine omega-3; heart and inflammation.' },
  { key: 'omega3_dha_mg',   name: 'DHA',          category: 'lipid',   unit: 'mg',  target: 250,  sourceType: 'AI', description: 'Marine omega-3; brain and eyes.' },
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
