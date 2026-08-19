import { apiFetch } from './base';

async function readJsonIfPresent(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text) return null;
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchPrep(date) {
  const res = await apiFetch(`/api/prep?date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load prep');
  }
  return res.json();
}

export async function createPrepItem(date, payload) {
  const res = await apiFetch('/api/prep', {
    method: 'POST',
    body: JSON.stringify({ date, payload }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to add prep item');
  }
  return res.json();
}

export async function patchPrepItem(id, body) {
  const res = await apiFetch(`/api/prep/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to update prep item');
  }
  return res.json();
}

export async function dismissPrepItem(id) {
  const res = await apiFetch(`/api/prep/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to dismiss');
  }
  return res.json();
}

export async function restorePrepItem(id) {
  const res = await apiFetch(`/api/prep/${id}/restore`, { method: 'POST', body: '{}' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to restore');
  }
  return res.json();
}
