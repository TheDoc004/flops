/**
 * openFoodFactsService — turns a scanned barcode into ingredient-form fields
 * using the free Open Food Facts API (no key, no self-hosted product database).
 *
 * The server proxies the call for two reasons: it avoids CORS in the browser,
 * and it gives one place to normalize the very uneven shapes OFF returns. This
 * module only SHAPES data — the user-facing "review this" wording lives in the
 * client merge function, mirroring how label-ocr splits parsing from feedback.
 */

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';

// Ask for only what we map — OFF products are otherwise huge documents.
const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
  'nutrition_data_per',
  'image_front_small_url',
].join(',');

// OFF asks API clients to identify themselves so they can contact heavy users.
const USER_AGENT = 'FLOPS-NutritionTracker/1.0 (personal use)';
const TIMEOUT_MS = 8000;

/** The product database was unreachable or misbehaving — worth retrying. */
class BarcodeLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BarcodeLookupError';
  }
}
/** The barcode is well-formed but no such product exists in Open Food Facts. */
class BarcodeNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BarcodeNotFoundError';
  }
}

/** Digits only, 8-14 long (EAN-8 through GTIN-14). Returns null if unusable. */
function normalizeBarcode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const round2 = n => (n == null ? null : Math.round(n * 100) / 100);

/**
 * Calories for a basis suffix ('serving' | '100g'). OFF sometimes carries only
 * kilojoules, so fall back and convert.
 */
function kcalFor(nutriments, suffix) {
  const direct = num(nutriments[`energy-kcal_${suffix}`]);
  if (direct != null) return direct;
  const kj = num(nutriments[`energy-kj_${suffix}`]) ?? num(nutriments[`energy_${suffix}`]);
  return kj == null ? null : kj / 4.184;
}

/**
 * Open Food Facts nutriment -> our canonical micro key, with the factor that
 * converts OFF's value into our unit. OFF stores these in GRAMS (Cheerios
 * lists vitamin-a as 0.00015, i.e. 150 mcg), so everything scales up.
 */
const MICRO_SOURCES = {
  sodium: ['sodium_mg', 1000],
  potassium: ['potassium_mg', 1000],
  calcium: ['calcium_mg', 1000],
  iron: ['iron_mg', 1000],
  magnesium: ['magnesium_mg', 1000],
  zinc: ['zinc_mg', 1000],
  'vitamin-a': ['vitamin_a_mcg', 1e6],
  'vitamin-c': ['vitamin_c_mg', 1000],
  'vitamin-d': ['vitamin_d_mcg', 1e6],
  folates: ['folate_mcg', 1e6],
  'vitamin-b12': ['vitamin_b12_mcg', 1e6],
  fiber: ['fiber_g', 1],
};

/**
 * Micronutrients for one basis, as { key: amount } in our units. These are off
 * the manufacturer's own panel, so they beat an AI estimate — the log route
 * prefers them and only asks the AI to fill what's missing.
 */
function microsFor(nutriments, suffix) {
  const out = {};
  for (const [offKey, [key, factor]] of Object.entries(MICRO_SOURCES)) {
    const raw = num(nutriments[`${offKey}_${suffix}`]);
    if (raw == null || raw <= 0) continue;
    out[key] = Math.round(raw * factor * 100) / 100;
  }
  return out;
}

/** Macros for one basis. Missing values stay null so the UI can leave them blank. */
function macrosFor(nutriments, suffix) {
  return {
    calories: kcalFor(nutriments, suffix),
    protein_g: num(nutriments[`proteins_${suffix}`]),
    carbs_g: num(nutriments[`carbohydrates_${suffix}`]),
    fat_g: num(nutriments[`fat_${suffix}`]),
    fiber_g: num(nutriments[`fiber_${suffix}`]),
  };
}

const hasAnyMacro = m => Object.values(m).some(v => v != null && v > 0);
const scaleMacros = (m, factor) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) out[k] = v == null ? null : v * factor;
  return out;
};
const roundMacros = m => {
  const out = {};
  for (const [k, v] of Object.entries(m)) out[k] = round2(v);
  return out;
};

/**
 * Raw OFF product -> ingredient-form fields.
 *
 * `basis` tells the UI where the numbers came from, because that is the thing
 * most worth double-checking:
 *   'serving'         — OFF listed per-serving values directly
 *   'serving_derived' — OFF knew the serving size but only per-100g values, so
 *                       these were scaled down (label serving, computed macros)
 *   '100g'            — no serving size on record; the form is set to 100 g
 * Exported for unit tests.
 */
function shapeOffProduct(product, code) {
  const nutriments = product?.nutriments && typeof product.nutriments === 'object' ? product.nutriments : {};
  const name = String(product?.product_name || product?.product_name_en || '').trim().slice(0, 120);
  // OFF stores brands as a comma-separated list; the first is the primary one.
  const brand_name = String(product?.brands || '').split(',')[0].trim().slice(0, 64);

  const servingAmount = num(product?.serving_quantity);
  const servingUnit = String(product?.serving_quantity_unit || '').trim().toLowerCase() === 'ml' ? 'ml' : 'g';
  const perServing = macrosFor(nutriments, 'serving');
  const per100 = macrosFor(nutriments, '100g');

  let basis;
  let serving_amount;
  let serving_unit;
  let macros;
  // Micros follow the macros' basis exactly, so the two always describe the
  // same portion — a serving's macros can't sit next to per-100g micros.
  let micros;
  if (servingAmount != null && servingAmount > 0 && hasAnyMacro(perServing)) {
    basis = 'serving';
    serving_amount = servingAmount;
    serving_unit = servingUnit;
    macros = perServing;
    micros = microsFor(nutriments, 'serving');
  } else if (servingAmount != null && servingAmount > 0 && hasAnyMacro(per100)) {
    basis = 'serving_derived';
    serving_amount = servingAmount;
    serving_unit = servingUnit;
    macros = scaleMacros(per100, servingAmount / 100);
    micros = roundMacros(scaleMacros(microsFor(nutriments, '100g'), servingAmount / 100));
  } else if (hasAnyMacro(per100)) {
    basis = '100g';
    serving_amount = 100;
    serving_unit = 'g';
    macros = per100;
    micros = microsFor(nutriments, '100g');
  } else {
    // Product exists but carries no usable macros — the form still gets the
    // name/brand so OCR or manual entry can finish the job. Micros can still be
    // on record though (mineral water lists calcium and no calories), so keep
    // whichever basis has them rather than throwing them away.
    basis = 'none';
    serving_amount = null;
    serving_unit = 'g';
    macros = { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null };
    const perServingMicros = microsFor(nutriments, 'serving');
    micros = Object.keys(perServingMicros).length ? perServingMicros : microsFor(nutriments, '100g');
  }

  return {
    found: true,
    barcode: code,
    name,
    brand_name,
    basis,
    serving_amount: round2(serving_amount),
    serving_unit,
    // OFF's own serving text (e.g. "1 cup (240 ml)") — shown as context, not parsed.
    serving_size_text: String(product?.serving_size || '').trim().slice(0, 120),
    package_quantity: String(product?.quantity || '').trim().slice(0, 64),
    macros: roundMacros(macros),
    // Straight off the manufacturer's panel — more trustworthy than an estimate.
    micros,
    image_url: String(product?.image_front_small_url || '').trim(),
  };
}

/** One OFF request. Returns the product object, or null when not on record. */
async function fetchOffProduct(code, fetchImpl) {
  const url = `${OFF_BASE}/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new BarcodeLookupError('Could not reach the product database. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new BarcodeLookupError('The product database had a problem. Please try again.');
  let body;
  try {
    body = await res.json();
  } catch {
    throw new BarcodeLookupError('The product database sent an unreadable response.');
  }
  // v2 signals a miss with status 0 (usually alongside 404, but not always).
  if (!body || body.status === 0 || !body.product) return null;
  return body.product;
}

/**
 * Look up a barcode -> ingredient-form fields.
 * @param {string} rawCode digits as scanned or typed
 * @param {{ fetchImpl?: Function }} [opts] injectable fetch (tests)
 * @throws {BarcodeNotFoundError|BarcodeLookupError}
 */
async function lookupBarcode(rawCode, { fetchImpl = globalThis.fetch } = {}) {
  const code = normalizeBarcode(rawCode);
  if (!code) throw new BarcodeNotFoundError('That barcode does not look valid.');

  let product = await fetchOffProduct(code, fetchImpl);
  // US products scan as 12-digit UPC-A but are stored as 13-digit EAN with a
  // leading zero — retry that form before giving up.
  if (!product && code.length === 12) {
    product = await fetchOffProduct(`0${code}`, fetchImpl);
  }
  if (!product) throw new BarcodeNotFoundError('That product is not in Open Food Facts yet.');
  return shapeOffProduct(product, code);
}

module.exports = {
  lookupBarcode,
  shapeOffProduct,
  normalizeBarcode,
  BarcodeLookupError,
  BarcodeNotFoundError,
};
