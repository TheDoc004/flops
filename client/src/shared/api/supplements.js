import { apiUrl } from './base';

async function jsonOrThrow(res, fallback) {
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || fallback);
  }
  return res.json();
}

export async function fetchSupplements() {
  const res = await fetch(apiUrl('/api/supplements'));
  return jsonOrThrow(res, 'Failed to load supplements');
}

export async function fetchSupplementsToday(date) {
  const res = await fetch(apiUrl(`/api/supplements/today?date=${encodeURIComponent(date)}`));
  return jsonOrThrow(res, "Failed to load today's supplements");
}

// Taken supplements with micros, grouped by date, for a range (History micros).
export async function fetchSupplementRange(start, end) {
  const res = await fetch(
    apiUrl(`/api/supplements/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
  );
  return jsonOrThrow(res, 'Failed to load supplement range');
}

// Send a (cropped) Supplement Facts photo → suggested { name, dose_text, macros, micros }.
// The image is posted as a raw binary body, matching the server's express.raw route.
export async function scanSupplementLabel(imageBlob) {
  const res = await fetch(apiUrl('/api/supplements/scan-label'), {
    method: 'POST',
    headers: { 'Content-Type': imageBlob.type || 'image/jpeg' },
    body: imageBlob,
  });
  return jsonOrThrow(res, 'Failed to scan supplement label');
}

export async function createSupplement(payload) {
  const res = await fetch(apiUrl('/api/supplements'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res, 'Failed to create supplement');
}

export async function updateSupplement(id, payload) {
  const res = await fetch(apiUrl(`/api/supplements/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res, 'Failed to update supplement');
}

export async function deleteSupplement(id) {
  const res = await fetch(apiUrl(`/api/supplements/${id}`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to delete supplement');
  }
}

export async function setSupplementTaken({ date, supplement_id, taken }) {
  const res = await fetch(apiUrl('/api/supplements/log'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, supplement_id, taken: taken ? 1 : 0 }),
  });
  return jsonOrThrow(res, 'Failed to update supplement');
}

/**
 * Search the NIH Dietary Supplement Label Database by product/brand name —
 * the no-photo path to a supplement's micros.
 */
export async function searchSupplementDatabase(q) {
  const res = await fetch(apiUrl(`/api/supplements/search?q=${encodeURIComponent(q)}`));
  return jsonOrThrow(res, 'Supplement search failed');
}

/** Pull one matched product's label, shaped exactly like a scanned label. */
export async function fetchSupplementFromDatabase(id) {
  const res = await fetch(apiUrl(`/api/supplements/dsld/${encodeURIComponent(id)}`));
  return jsonOrThrow(res, 'Failed to load that supplement');
}

/**
 * Fallback for products the database doesn't carry: estimate micros from the
 * name. Always an estimate — the result is stored below label confidence.
 */
export async function estimateSupplementFromName(name) {
  const res = await fetch(apiUrl('/api/supplements/estimate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow(res, 'Failed to estimate that supplement');
}
