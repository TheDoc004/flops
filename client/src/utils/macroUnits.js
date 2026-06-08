/** US food labels: 1 oz mass = 28.3495 g */
export const GRAMS_PER_OZ = 28.3495;

export function gramsToOz(g) {
  if (g == null || !Number.isFinite(Number(g))) return null;
  return Number(g) / GRAMS_PER_OZ;
}

export function ozToGrams(oz) {
  if (oz == null || !Number.isFinite(Number(oz))) return null;
  return Number(oz) * GRAMS_PER_OZ;
}

/** Display macro mass: grams (metric) or ounces (us) */
export function formatMacroMass(grams, macroUnits) {
  if (grams == null || !Number.isFinite(Number(grams))) return '—';
  const g = Number(grams);
  if (macroUnits === 'us') {
    return `${gramsToOz(g).toFixed(1)} oz`;
  }
  return `${g.toFixed(1)} g`;
}

/** String for number inputs (stable rounding) */
export function gramsToInputValue(grams, macroUnits) {
  if (grams === '' || grams == null) return '';
  const g = Number(grams);
  if (!Number.isFinite(g)) return '';
  if (macroUnits === 'us') {
    const oz = gramsToOz(g);
    return String(Math.round(oz * 100) / 100);
  }
  return String(Math.round(g * 100) / 100);
}

/** Parse user input to grams; null if empty/invalid */
export function parseMacroInputToGrams(raw, macroUnits) {
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return macroUnits === 'us' ? ozToGrams(n) : n;
}

export function macroLabelSuffix(macroUnits) {
  return macroUnits === 'us' ? '(oz)' : '(g)';
}

/**
 * Remaining = target - consumed (grams internally).
 * Returns { text, kind: 'left' | 'over' | null }
 */
export function formatRemaining(targetG, consumedG, macroUnits) {
  if (targetG == null || !Number.isFinite(Number(targetG))) return null;
  if (!Number.isFinite(Number(consumedG))) return null;
  const diff = Number(targetG) - Number(consumedG);
  const absG = Math.abs(diff);
  const mass = formatMacroMass(absG, macroUnits);
  if (diff > 0) return { text: `${mass} left`, kind: 'left' };
  if (diff < 0) return { text: `${mass} over`, kind: 'over' };
  return { text: 'On target', kind: 'neutral' };
}

export function formatCalorieRemaining(targetCal, consumedCal) {
  if (targetCal == null || !Number.isFinite(Number(targetCal))) return null;
  if (!Number.isFinite(Number(consumedCal))) return null;
  const diff = Number(targetCal) - Number(consumedCal);
  const n = Math.round(Math.abs(diff));
  if (diff > 0) return { text: `${n} cal left`, kind: 'left' };
  if (diff < 0) return { text: `${n} cal over`, kind: 'over' };
  return { text: 'On target', kind: 'neutral' };
}
