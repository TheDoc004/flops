/**
 * GTIN check-digit validation (EAN-8, UPC-A, EAN-13, GTIN-14).
 *
 * Every retail barcode ends in a check digit computed from the others, so a
 * misread almost always fails this test. Validating before spending a network
 * request means a blurry frame is silently ignored instead of coming back as
 * "product not found", which would send you hunting for the wrong problem.
 */

const VALID_LENGTHS = [8, 12, 13, 14];

/** Digits only. Returns '' when the input has none. */
export function digitsOnly(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidGtin(raw) {
  const code = digitsOnly(raw);
  if (!VALID_LENGTHS.includes(code.length)) return false;

  // Weights alternate 3/1 from the right, excluding the check digit itself.
  const body = code.slice(0, -1);
  const check = Number(code.slice(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === check;
}
