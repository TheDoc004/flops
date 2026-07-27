/**
 * dsldService — look a supplement up BY NAME in the NIH Dietary Supplement
 * Label Database (DSLD) instead of photographing its label.
 *
 * DSLD is free, needs no API key, and holds transcribed label data for ~180k
 * US products, so a match gives label-exact per-serving amounts — the same
 * quality tier as the photo scan, without the phone-to-computer round trip.
 *
 * Output deliberately mirrors `scanSupplementLabel`'s shape
 * ({name, dose_text, macros, micros, confidence, notes}) so the client prefills
 * a matched product through exactly the same path as a scanned one.
 */

const { MICRO_KEYS, MICRO_UNITS, buildMicrosBlob } = require('./microNutrients');
const { shapeMacros } = require('./supplementLabelService');

const DSLD_BASE = 'https://api.ods.od.nih.gov/dsld/v9';
const USER_AGENT = 'FLOPS-NutritionTracker/1.0 (personal use)';
const TIMEOUT_MS = 10000;

/** DSLD groups its ingredients under normalized names; map those to our keys. */
const GROUP_TO_KEY = {
  'vitamin a': 'vitamin_a_mcg',
  'vitamin c': 'vitamin_c_mg',
  'vitamin d': 'vitamin_d_mcg',
  calcium: 'calcium_mg',
  iron: 'iron_mg',
  magnesium: 'magnesium_mg',
  zinc: 'zinc_mg',
  folate: 'folate_mcg',
  'folic acid': 'folate_mcg',
  'vitamin b12': 'vitamin_b12_mcg',
  sodium: 'sodium_mg',
  potassium: 'potassium_mg',
  'dietary fiber': 'fiber_g',
  fiber: 'fiber_g',
};

/** Macro groups a supplement panel may also carry (protein powders etc.). */
// Keys are already lowercased and stripped of parentheticals, so DSLD's
// "Protein (unspecified)" and "Total Carbohydrates" both land here.
const GROUP_TO_MACRO = {
  calories: 'calories',
  protein: 'protein_g',
  'total carbohydrate': 'carbs_g',
  'total carbohydrates': 'carbs_g',
  carbohydrate: 'carbs_g',
  carbohydrates: 'carbs_g',
  'total fat': 'fat_g',
  fat: 'fat_g',
};

const MASS_TO_MG = { g: 1000, mg: 1, mcg: 0.001, ug: 0.001, µg: 0.001 };

/**
 * DSLD writes units as words ("Gram(s)", "Milligram(s)") on some labels and
 * symbols ("mg", "mcg", "IU") on others — normalize before converting.
 */
const UNIT_ALIASES = {
  'gram(s)': 'g',
  gram: 'g',
  grams: 'g',
  'milligram(s)': 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  'microgram(s)': 'mcg',
  microgram: 'mcg',
  micrograms: 'mcg',
  'calorie(s)': 'cal',
  calorie: 'cal',
  calories: 'cal',
  kcal: 'cal',
  'international unit(s)': 'iu',
};

function normalizeUnit(raw) {
  const u = String(raw ?? '').trim().toLowerCase();
  return UNIT_ALIASES[u] || u;
}

/**
 * Candidate lookup names for a row, most specific first. DSLD qualifies groups
 * as "Protein (unspecified)" / "Fat (unspecified)", so parentheticals are
 * stripped, and the row's own name is tried as a fallback.
 */
function groupCandidates(row) {
  const clean = s =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const out = [clean(row?.ingredientGroup), clean(row?.name)];
  return [...new Set(out.filter(Boolean))];
}

/**
 * International Units are unit-less potency, so converting needs to know the
 * nutrient AND (for vitamin A) which form it came as. Retinol is assumed —
 * beta-carotene converts at half that — so every IU value gets flagged.
 */
const IU_TO_MG = {
  vitamin_d_mcg: 0.000025, // 1 IU = 0.025 mcg
  vitamin_a_mcg: 0.0003, // 1 IU = 0.3 mcg retinol
};

class DsldError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DsldError';
  }
}

async function dsldFetch(path, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`${DSLD_BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new DsldError('Could not reach the supplement database. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new DsldError('The supplement database had a problem. Please try again.');
  try {
    return await res.json();
  } catch {
    throw new DsldError('The supplement database sent an unreadable response.');
  }
}

/** "1 Tablet(s)" -> "1 Tablet"; DSLD's plural marker reads badly in a form. */
function servingText(label) {
  const s = Array.isArray(label?.servingSizes) ? label.servingSizes[0] : null;
  if (!s) return '';
  const qty = Number(s.minQuantity);
  const unit = String(s.unit || '').replace(/\(s\)$/i, '').trim();
  if (!Number.isFinite(qty) || qty <= 0) return unit;
  const plural = qty === 1 || !unit ? unit : `${unit}s`;
  return `${+qty.toFixed(2)} ${plural}`.trim();
}

/**
 * Search by product or brand name.
 * @returns {Promise<Array<{id,name,brand,off_market,entry_date,product_type}>>}
 */
async function searchSupplements(query, { limit = 12, fetchImpl = globalThis.fetch } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const size = Math.min(Math.max(Number(limit) || 12, 1), 25);
  const body = await dsldFetch(`/search-filter?q=${encodeURIComponent(q)}&size=${size}`, fetchImpl);
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  return hits
    .map(h => {
      const src = h?._source || {};
      return {
        id: String(h?._id ?? ''),
        name: String(src.fullName || '').trim(),
        brand: String(src.brandName || '').trim(),
        // Off-market products are still useful (you may own an old bottle) but
        // are ranked last and labelled in the UI.
        off_market: src.offMarket === 1 || src.offMarket === true,
        entry_date: String(src.entryDate || '').trim(),
        product_type: String(src.productType?.langualCodeDescription || '').trim(),
      };
    })
    .filter(r => r.id && r.name)
    .sort((a, b) => Number(a.off_market) - Number(b.off_market));
}

/** One ingredient row -> { key, value } in our canonical unit, or null. */
function mapIngredientRow(row) {
  const candidates = groupCandidates(row);
  const group = candidates.find(c => GROUP_TO_KEY[c]);
  const key = group ? GROUP_TO_KEY[group] : null;
  if (!key) return null;
  const q = Array.isArray(row?.quantity) ? row.quantity[0] : null;
  const amount = Number(q?.quantity);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const unit = normalizeUnit(q?.unit);
  const target = MICRO_UNITS[key];
  let mg = null;
  let converted = false;

  if (unit === 'iu') {
    const factor = IU_TO_MG[key];
    if (factor == null) return null; // IU for something we can't convert
    mg = amount * factor;
    converted = true;
  } else if (unit === 'mcg dfe' || unit === 'mcg dfe folate') {
    // Folate as Dietary Folate Equivalents — same magnitude as mcg for a
    // supplement's synthetic folic acid, close enough to store, worth noting.
    mg = amount * MASS_TO_MG.mcg;
    converted = true;
  } else if (MASS_TO_MG[unit] != null) {
    mg = amount * MASS_TO_MG[unit];
  } else {
    return null;
  }

  const value = target === 'g' ? mg / 1000 : target === 'mcg' ? mg * 1000 : mg;
  return { key, value: Math.round(value * 100) / 100, converted, rawUnit: unit, rawAmount: amount, group };
}

/** Macro rows (calories/protein/carbs/fat) if the panel lists them. */
function mapMacroRow(row) {
  const candidates = groupCandidates(row);
  const group = candidates.find(c => GROUP_TO_MACRO[c]);
  const key = group ? GROUP_TO_MACRO[group] : null;
  if (!key) return null;
  const q = Array.isArray(row?.quantity) ? row.quantity[0] : null;
  const amount = Number(q?.quantity);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = normalizeUnit(q?.unit);
  // Macros are stored in grams; convert whatever mass unit the label used.
  if (key !== 'calories' && MASS_TO_MG[unit] != null) {
    return { key, value: Math.round(((amount * MASS_TO_MG[unit]) / 1000) * 100) / 100 };
  }
  return { key, value: Math.round(amount * 100) / 100 };
}

/**
 * Fetch one DSLD label and shape it like a scanned label.
 * @returns {Promise<object|null>} null when the id isn't in DSLD
 */
async function fetchSupplementLabel(id, { fetchImpl = globalThis.fetch } = {}) {
  const cleanId = String(id ?? '').trim();
  if (!/^\d+$/.test(cleanId)) throw new DsldError('Invalid supplement id.');
  const label = await dsldFetch(`/label/${cleanId}`, fetchImpl);
  if (!label || !label.fullName) return null;

  const rows = Array.isArray(label.ingredientRows) ? label.ingredientRows : [];
  const micros = {};
  const macros = {};
  const convertedNotes = [];
  const untracked = new Set();

  for (const row of rows) {
    const macro = mapMacroRow(row);
    if (macro) {
      macros[macro.key] = macro.value;
      continue;
    }
    const mapped = mapIngredientRow(row);
    if (mapped) {
      // Labels can list the same nutrient twice (different forms) — sum them.
      micros[mapped.key] = Math.round(((micros[mapped.key] || 0) + mapped.value) * 100) / 100;
      if (mapped.converted) {
        convertedNotes.push(`${row.ingredientGroup} listed as ${mapped.rawAmount} ${mapped.rawUnit}`);
      }
      continue;
    }
    const group = String(row?.ingredientGroup || '').trim();
    if (group) untracked.add(group);
  }

  const notes = [];
  if (convertedNotes.length) {
    notes.push(`Converted to standard units: ${convertedNotes.join('; ')}. Check these against the bottle.`);
  }
  if (untracked.size) {
    notes.push(`This label also lists ${[...untracked].slice(0, 8).join(', ')}${untracked.size > 8 ? '…' : ''}, which this app doesn't track yet.`);
  }
  if (label.offMarket === 1) {
    notes.push('Marked off-market in the database — the formula may have changed since.');
  }

  return {
    dsld_id: cleanId,
    name: String(label.fullName || '').trim().slice(0, 120),
    brand: String(label.brandName || '').trim().slice(0, 64),
    dose_text: servingText(label).slice(0, 120),
    macros: shapeMacros(macros),
    micros,
    // Real label transcription, same tier as a photo scan — but anything we had
    // to convert is called out in notes for review.
    confidence: 'high',
    notes: notes.join(' '),
    entry_date: String(label.entryDate || '').trim(),
    off_market: label.offMarket === 1,
    upc: String(label.upcSku || '').trim(),
    untracked_count: untracked.size,
  };
}

/** Convenience: the storable blob for a fetched label. */
function microsBlobFromLabel(label) {
  return buildMicrosBlob(label?.micros, { confidence: label?.confidence, notes: label?.notes });
}

module.exports = {
  searchSupplements,
  fetchSupplementLabel,
  microsBlobFromLabel,
  mapIngredientRow,
  servingText,
  DsldError,
  GROUP_TO_KEY,
  MICRO_KEYS,
};
