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

export async function fetchLabelIngredients() {
  const res = await apiFetch('/api/label-ingredients');
  if (!res.ok) throw new Error('Failed to load label ingredients');
  return res.json();
}

export async function createLabelIngredient(body) {
  const res = await apiFetch('/api/label-ingredients', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save label ingredient');
  }
  return res.json();
}

export async function deleteLabelIngredient(id) {
  const res = await apiFetch(`/api/label-ingredients/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete');
  }
}

export async function updateLabelIngredient(id, body) {
  const res = await apiFetch(`/api/label-ingredients/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to update ingredient');
  }
  return res.json();
}

export async function markLabelIngredientsUsed(ids) {
  const res = await apiFetch('/api/label-ingredients/used', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to mark used');
  }
  return res.json();
}
