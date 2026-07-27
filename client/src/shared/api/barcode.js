import { apiUrl } from './base';

/**
 * Look up a scanned barcode. The server proxies Open Food Facts and normalizes
 * the result into ingredient-form fields.
 *
 * A "product not on record" answer is an ordinary outcome, not a failure, so it
 * comes back as an error carrying `notFound` — the UI offers the label-scan and
 * manual paths instead of showing a red error.
 */
export async function lookupBarcode(code) {
  const res = await fetch(apiUrl(`/api/barcode/${encodeURIComponent(code)}?user_id=0`));
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* fall through to the status-based message */
  }
  if (!res.ok) {
    const err = new Error(body?.error || 'Barcode lookup failed.');
    err.notFound = res.status === 404;
    err.barcode = code;
    throw err;
  }
  return body;
}
