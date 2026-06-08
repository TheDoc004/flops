import { apiUrl } from './base';

export async function fetchRecipes({ includeArchived = false } = {}) {
  const q = includeArchived ? '?include_archived=1' : '';
  const res = await fetch(apiUrl(`/api/recipes${q}`));
  if (!res.ok) throw new Error('Failed to fetch recipes');
  return res.json();
}

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

export async function fetchRecipe(id) {
  const res = await fetch(apiUrl(`/api/recipes/${id}`));
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to fetch recipe (HTTP ${res.status})`);
  }
  const json = await readJsonIfPresent(res);
  if (!json) throw new Error('Failed to fetch recipe (invalid server response)');
  return json;
}

export async function createRecipe(data) {
  const res = await fetch(apiUrl('/api/recipes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to create recipe (HTTP ${res.status})`);
  }
  const json = await readJsonIfPresent(res);
  if (!json) throw new Error('Failed to create recipe (invalid server response)');
  return json;
}

export async function updateRecipe(id, data) {
  const res = await fetch(apiUrl(`/api/recipes/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to update recipe (HTTP ${res.status})`);
  }
  const json = await readJsonIfPresent(res);
  if (!json) throw new Error('Failed to update recipe (invalid server response)');
  return json;
}

export async function deleteRecipe(id) {
  const res = await fetch(apiUrl(`/api/recipes/${id}`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to delete recipe (HTTP ${res.status})`);
  }
}

export async function reactivateLimitedRecipe(id, remainingUses) {
  const res = await fetch(apiUrl(`/api/recipes/${id}/reactivate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remaining_uses: remainingUses }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || `Failed to reactivate (HTTP ${res.status})`);
  }
  const json = await readJsonIfPresent(res);
  if (!json) throw new Error('Invalid server response');
  return json;
}
