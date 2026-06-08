/** Body measurements: storage always metric (cm, kg); display/input may use US */

export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;
export const LB_PER_KG = 2.20462;

export function cmToInches(cm) {
  if (cm == null || !Number.isFinite(Number(cm)) || Number(cm) <= 0) return null;
  return Number(cm) / CM_PER_INCH;
}

export function inchesToCm(inches) {
  if (inches == null || !Number.isFinite(Number(inches)) || Number(inches) <= 0) return null;
  return Number(inches) * CM_PER_INCH;
}

/**
 * US height: feet (integer) + inches (decimal ok).
 * Returns string fields for controlled inputs; empty height -> '', ''.
 */
export function cmToFeetInches(cm) {
  if (cm === '' || cm == null || !Number.isFinite(Number(cm)) || Number(cm) <= 0) {
    return { feet: '', inches: '' };
  }
  const totalIn = Number(cm) / CM_PER_INCH;
  let feet = Math.floor(totalIn / INCHES_PER_FOOT);
  let inches = totalIn - feet * INCHES_PER_FOOT;
  inches = Math.round(inches * 100) / 100;
  if (inches >= 12 - 1e-9) {
    feet += 1;
    inches = 0;
  }
  return { feet: String(feet), inches: String(inches) };
}

/** At least one of feet/inches should be non-empty to produce a height */
export function feetInchesToCm(feetRaw, inchesRaw) {
  const f = feetRaw === '' || feetRaw == null ? 0 : Number(feetRaw);
  const inch = inchesRaw === '' || inchesRaw == null ? 0 : Number(inchesRaw);
  if (!Number.isFinite(f) || !Number.isFinite(inch) || f < 0 || inch < 0) return null;
  if (f === 0 && inch === 0) return null;
  const totalIn = f * INCHES_PER_FOOT + inch;
  if (totalIn <= 0) return null;
  return totalIn * CM_PER_INCH;
}

export function kgToLb(kg) {
  if (kg == null || !Number.isFinite(Number(kg))) return null;
  return Number(kg) * LB_PER_KG;
}

export function lbToKg(lb) {
  if (lb == null || !Number.isFinite(Number(lb))) return null;
  return Number(lb) / LB_PER_KG;
}

/** One-line display for read-only kg in chosen system */
export function formatWeightKg(kg, unitSystem) {
  if (kg == null || !Number.isFinite(Number(kg))) return '—';
  if (unitSystem === 'us') {
    return `${kgToLb(Number(kg)).toFixed(1)} lb`;
  }
  return `${Number(kg).toFixed(1)} kg`;
}

/** String for controlled weight input (kg internal) */
export function kgToWeightInputValue(kg, unitSystem) {
  if (kg === '' || kg == null) return '';
  const k = Number(kg);
  if (!Number.isFinite(k)) return '';
  if (unitSystem === 'us') {
    return String(Math.round(kgToLb(k) * 100) / 100);
  }
  return String(Math.round(k * 100) / 100);
}

/** Parse weight field to kg */
export function parseWeightInputToKg(raw, unitSystem) {
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unitSystem === 'us') {
    const kg = lbToKg(n);
    return kg != null && kg > 0 && kg <= 500 ? kg : null;
  }
  return n <= 500 ? n : null;
}
