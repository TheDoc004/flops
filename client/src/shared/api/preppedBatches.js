import { apiFetch } from './base';

export async function fetchPreppedBatches({ includeDepleted = false } = {}) {
  const q = includeDepleted ? '?include_depleted=1' : '';
  const res = await apiFetch(`/api/prepped-batches${q}`);
  if (!res.ok) throw new Error('Failed to load prepped batches');
  return res.json();
}

export async function createPreppedBatch(data) {
  const res = await apiFetch('/api/prepped-batches', { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error || 'Failed to create prepped batch');
  }
  return res.json();
}

export async function markPreppedBatchDepleted(id) {
  const res = await apiFetch(`/api/prepped-batches/${id}/deplete`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mark batch depleted');
  return res.json();
}
