/**
 * Heuristic parser for OCR / pasted Nutrition Facts text.
 * Prefer leaving fields blank over wrong guesses. Macros: fat → carbs → protein (fiber optional).
 * Tolerates noisy OCR (colored labels, branding, small type).
 */

function firstFloat(s) {
  if (s == null) return null;
  const m = /([\d.]+)/.exec(String(s));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Returns null for "<1g" style — do not invent a gram value. */
function parseMacroGrams(rawChunk, labelForWarning, warnings, fieldStatus, key) {
  const s = String(rawChunk || '');
  if (/<\s*1/i.test(s) && /g/i.test(s)) {
    warnings.push(`${labelForWarning} appears as “<1g” — enter manually if needed.`);
    if (fieldStatus && key) fieldStatus[key] = 'uncertain';
    return null;
  }
  const v = firstFloat(s);
  if (fieldStatus && key && v != null) fieldStatus[key] = 'filled';
  return v;
}

function flattenLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize common OCR noise for pattern matching */
function ocrNormalize(s) {
  return String(s || '')
    .replace(/nutriti[o0]n/gi, 'nutrition')
    .replace(/s[e3]rv[il1]ng/gi, 'serving')
    .replace(/cal[o0]r[il1]es/gi, 'calories')
    .replace(/[|Il]{1,2}\s*g\b/gi, ' g') // pipe/I/l glitches near g
    .replace(/\s+/g, ' ');
}

/**
 * Nutrition Facts region — prefer slice after header; fallback to full text if header OCR fails.
 */
function nutritionFactsSection(flat) {
  const lower = flat.toLowerCase();
  let i = lower.indexOf('nutrition facts');
  if (i < 0) i = lower.indexOf('nutriti'); // partial OCR
  if (i < 0) return { section: flat, hasFactsHeader: false, start: 0 };
  return { section: flat.slice(i, i + 4000), hasFactsHeader: true, start: i };
}

function defaultFieldStatus() {
  return {
    calories: 'missing',
    carbs_g: 'missing',
    protein_g: 'missing',
    fat_g: 'missing',
    serving_size_text: 'missing',
    grams_per_serving: 'missing',
    fiber_g: 'missing',
  };
}

function tryCalories(section, flat, warnings, fieldStatus) {
  const hay = [section, flat, ocrNormalize(section), ocrNormalize(flat)];
  const patterns = [
    /\bcalories\b[\s:]*(\d{1,4})\b/i,
    /\bcalories\b\D{0,40}?(\d{1,4})\b/i,
    /\bcal[orie]{0,8}s?\b[\s:]*(\d{1,4})\b/i,
    /(\d{1,4})\s+calories\b/i,
    /\bcal\b[\s:]*(\d{1,4})\b/i,
    /\benergy\b[^%]{0,45}?(\d{1,4})\s*(?:kj|kcal|cal)?/i,
  ];
  for (const text of hay) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v) && v >= 0 && v <= 12000) {
          fieldStatus.calories = 'filled';
          return v;
        }
      }
    }
  }
  warnings.push('Calories — add from the label if missing.');
  return null;
}

function tryServing(flat, warnings, fieldStatus) {
  const patterns = [
    /serving\s*size\s*[:\s]+(.+?)(?=\s+(?:servings?\s+per|amount\s+per|calories|total\s+fat|nutrition|carb|protein)\b)/i,
    /serving\s*size\s*[:\s]+([^(]{1,100}(?:\([^)]+\))?)/i,
    /amount\s+per\s+serving\s*[:\s]+(.+?)(?=\s+calories|\s+total|\s+carb)/i,
  ];
  for (const re of patterns) {
    const m = flat.match(re);
    if (m && m[1]) {
      let t = m[1].trim().replace(/\s+/g, ' ');
      t = t.replace(/\s*[|]\s*$/, '').slice(0, 120);
      if (t.length >= 2) {
        fieldStatus.serving_size_text = 'filled';
        const combined = m[0];
        const parenG = /\(([^)]*?(\d+(?:\.\d+)?)\s*g)\)/i.exec(combined + t);
        let g = null;
        if (parenG) g = Number(parenG[2]);
        if (g == null || !Number.isFinite(g)) {
          const bare = /(\d+(?:\.\d+)?)\s*g\b/i.exec(t);
          if (bare) g = Number(bare[1]);
        }
        if (g != null && Number.isFinite(g) && g > 0 && g < 10000) {
          fieldStatus.grams_per_serving = 'filled';
          return { serving_size_text: t, grams_per_serving: g };
        }
        return { serving_size_text: t, grams_per_serving: null };
      }
    }
  }
  warnings.push('Serving size — add from the label if missing.');
  return { serving_size_text: '', grams_per_serving: null };
}

/**
 * @param {string} text
 * @returns {{
 *   name: string,
 *   serving_size_text: string,
 *   grams_per_serving: number | null,
 *   calories: number | null,
 *   protein_g: number | null,
 *   carbs_g: number | null,
 *   fat_g: number | null,
 *   fiber_g: number | null,
 *   scanWarnings: string[],
 *   fieldStatus: Record<string, 'filled'|'missing'|'uncertain'>,
 * }}
 */
export function parseNutritionFactsText(text) {
  const raw = String(text || '');
  const flat = flattenLines(raw);
  const flatNorm = ocrNormalize(flat);
  const warnings = [];
  const fieldStatus = defaultFieldStatus();

  const out = {
    name: '',
    serving_size_text: '',
    grams_per_serving: null,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    scanWarnings: warnings,
    fieldStatus,
  };

  const { section, hasFactsHeader } = nutritionFactsSection(flatNorm);
  const sectionRaw = nutritionFactsSection(flat).section;

  const rawLower = raw.toLowerCase();
  const nfRawIdx = rawLower.indexOf('nutrition facts');
  const nfAlt = nfRawIdx < 0 ? rawLower.indexOf('nutriti') : nfRawIdx;
  const idx = nfRawIdx >= 0 ? nfRawIdx : nfAlt;
  if (idx > 0) {
    const before = raw.slice(0, idx);
    const line = before
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 1 && !/^servings?\s/i.test(l) && !/^nutrition/i.test(l));
    if (line) out.name = line.slice(0, 100);
  }

  const serving = tryServing(flatNorm, warnings, fieldStatus);
  out.serving_size_text = serving.serving_size_text;
  out.grams_per_serving = serving.grams_per_serving;

  // Calories: section + full flat + raw line breaks (split "Calories" / "120")
  let calM =
    section.match(/\bcalories\b\s*(\d{1,4})\b/i) ||
    section.match(/\bcalories\b\D{0,24}(\d{1,4})\b/i) ||
    flatNorm.match(/\bcalories\b\s*(\d{1,4})\b/i);
  if (!calM) {
    const rawSpaced = raw.replace(/\r/g, '\n');
    calM = rawSpaced.match(/\bcalories\b[\s:]*\n?\s*(\d{1,4})\b/im);
  }
  if (calM) {
    const v = Number(calM[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 12000) {
      out.calories = v;
      fieldStatus.calories = 'filled';
    } else warnings.push('Calories looked unclear — verify against the label.');
  }
  if (out.calories == null) {
    out.calories = tryCalories(sectionRaw, flatNorm, warnings, fieldStatus);
  }

  // Fat — Total Fat first
  let fatM = section.match(/total\s+fat\b[^0-9%]{0,55}?([\d.]+)\s*g/i);
  if (!fatM) fatM = section.match(/total\s+fat\b[^0-9%]{0,55}?(<\s*1)\s*g/i);
  if (!fatM) fatM = flatNorm.match(/\btotal\s*fat\b[^0-9%]{0,55}?([\d.]+)\s*g/i);
  if (!fatM) fatM = flatNorm.match(/\btotal\s*fat\b[^0-9%]{0,55}?(<\s*1)\s*g/i);
  if (fatM) {
    out.fat_g = parseMacroGrams(fatM[0], 'Total fat', warnings, fieldStatus, 'fat_g');
  }

  // Carbs — tolerant (OCR drops "Total")
  let carbM = section.match(/total\s*carb(?:ohydrate)?s?\b[^0-9%]{0,55}?([\d.]+)\s*g/i);
  if (!carbM) carbM = section.match(/total\s*carb(?:ohydrate)?s?\b[^0-9%]{0,55}?(<\s*1)\s*g/i);
  if (!carbM) carbM = flatNorm.match(/carb(?:ohydrate)?s?\b[^0-9%]{0,55}?([\d.]+)\s*g/i);
  if (carbM) {
    out.carbs_g = parseMacroGrams(carbM[0], 'Carbohydrates', warnings, fieldStatus, 'carbs_g');
  }

  // Protein
  let protM = section.match(/\bprotein\b[^0-9%]{0,45}?([\d.]+)\s*g/i);
  if (!protM) protM = section.match(/\bprotein\b[^0-9%]{0,45}?(<\s*1)\s*g/i);
  if (!protM) protM = flatNorm.match(/\bprotein\b[^0-9%]{0,45}?([\d.]+)\s*g/i);
  if (protM) {
    out.protein_g = parseMacroGrams(protM[0], 'Protein', warnings, fieldStatus, 'protein_g');
  }

  // Fiber (optional)
  let fibM =
    section.match(/dietary\s*fiber\b[^0-9%]{0,45}?([\d.]+)\s*g/i) ||
    section.match(/dietary\s*fiber\b[^0-9%]{0,45}?(<\s*1)\s*g/i);
  if (!fibM) {
    fibM =
      flatNorm.match(/\bfiber\b[^0-9%]{0,35}?([\d.]+)\s*g/i) ||
      flatNorm.match(/\bfiber\b[^0-9%]{0,35}?(<\s*1)\s*g/i);
  }
  if (fibM) {
    out.fiber_g = parseMacroGrams(fibM[0], 'Fiber', warnings, fieldStatus, 'fiber_g');
  }

  const filled = [
    out.serving_size_text,
    out.grams_per_serving,
    out.calories,
    out.fat_g,
    out.carbs_g,
    out.protein_g,
    out.fiber_g,
  ].filter(v => v !== null && v !== '').length;

  if (!hasFactsHeader && flat.length > 30) {
    warnings.push(
      '“Nutrition Facts” header was not found — numbers may be mixed with other label text. Compare each field.'
    );
  }

  if (filled <= 2 && flat.length > 40) {
    warnings.push('Partial scan — review highlighted fields before saving.');
  }

  return out;
}
