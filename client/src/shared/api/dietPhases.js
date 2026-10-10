import { apiFetch } from './base';
import { getLocalDateISO } from '@shared/utils/dateLocal';

async function errorFrom(res, fallback) {
  try {
    const body = await res.json();
    return new Error(body?.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

/** Phases touching [start, end], each with effective_end_date + ongoing. */
export async function fetchDietPhases({ start, end } = {}) {
  const qs = new URLSearchParams({ today: getLocalDateISO() });
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  const res = await apiFetch(`/api/diet-phases?${qs}`);
  if (!res.ok) throw await errorFrom(res, 'Failed to load diet phases');
  return res.json();
}

export async function createDietPhase(body) {
  const res = await apiFetch('/api/diet-phases', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw await errorFrom(res, 'Failed to save the phase');
  return res.json();
}

export async function updateDietPhase(id, body) {
  const res = await apiFetch(`/api/diet-phases/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) throw await errorFrom(res, 'Failed to save the phase');
  return res.json();
}

export async function deleteDietPhase(id) {
  const res = await apiFetch(`/api/diet-phases/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await errorFrom(res, 'Failed to delete the phase');
}
