import { apiUrl } from './base';

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
  const res = await fetch(apiUrl('/api/profile'));
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}

export async function saveProfile(body) {
  const res = await fetch(apiUrl('/api/profile'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...body }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save profile');
  }
  return res.json();
}

export async function fetchBodyWeights(start, end) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  const res = await fetch(apiUrl(`/api/body-weights${q}`));
  if (!res.ok) throw new Error('Failed to load weight history');
  return res.json();
}

export async function saveBodyWeight(date, weightKg) {
  const res = await fetch(apiUrl('/api/body-weights'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, date, weight_kg: weightKg }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save weight');
  }
  return res.json();
}

export async function deleteBodyWeight(date) {
  const res = await fetch(apiUrl(`/api/body-weights/${date}?user_id=0`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete entry');
  }
}
