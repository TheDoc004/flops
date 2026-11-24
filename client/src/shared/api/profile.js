import { apiFetch } from './base';
import { getLocalDateISO } from '@shared/utils/dateLocal';

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

export async function fetchProfile() {
  const res = await apiFetch('/api/profile');
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}

export async function saveProfile(body) {
  const res = await apiFetch('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save profile');
  }
  return res.json();
}

export async function fetchBodyWeights(start, end) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  const res = await apiFetch(`/api/body-weights${q}`);
  if (!res.ok) throw new Error('Failed to load weight history');
  return res.json();
}

export async function saveBodyWeight(date, weightKg) {
  const res = await apiFetch('/api/body-weights', {
    method: 'PUT',
    body: JSON.stringify({ date, weight_kg: weightKg }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save weight');
  }
  return res.json();
}

export async function deleteBodyWeight(date) {
  const res = await apiFetch(`/api/body-weights/${date}`, { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete entry');
  }
}

/** The signed-in user's own data as a JSON file, ready to hand to a download link. */
export async function fetchMyDataExport() {
  const res = await apiFetch('/api/me/export');
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Could not prepare your data.');
  }
  // Named here, not from Content-Disposition: the API is cross-origin, so the
  // browser hides that header from fetch().
  return { blob: await res.blob(), filename: `flops-export-${getLocalDateISO()}.json` };
}

/** Starts an account delete: emails a one-time code (or, Apple-only, returns a challenge). */
export async function requestAccountDelete() {
  const res = await apiFetch('/api/me/delete-request', { method: 'POST' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Could not start the delete.');
  }
  return res.json();
}

/** Deletes the signed-in account once the code checks out. The session ends with it. */
export async function deleteAccount(body) {
  const res = await apiFetch('/api/me', { method: 'DELETE', body: JSON.stringify(body) });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Could not delete the account.');
  }
  return res.json();
}
