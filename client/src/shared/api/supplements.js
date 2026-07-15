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
