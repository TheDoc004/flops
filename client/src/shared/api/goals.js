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

export async function fetchGoals({ date } = {}) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await apiFetch(`/api/goals${qs}`);
  if (!res.ok) throw new Error('Failed to load nutrition goals');
  return res.json();
}

export async function saveGoals(payload) {
  const res = await apiFetch('/api/goals', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to save goals (HTTP ${res.status})`);
  }
  return res.json();
}
