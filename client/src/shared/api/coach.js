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

export async function getInviteCode() {
  const res = await apiFetch('/api/coach/invite-code');
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load invite code');
  }
  return res.json();
}

export async function linkCoach(invite_code, scopes = {}) {
  const res = await apiFetch('/api/coach/link', {
    method: 'POST',
    body: JSON.stringify({ invite_code, ...scopes }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to link coach');
  }
  return res.json();
}

export async function myCoaches() {
  const res = await apiFetch('/api/coach/my-coaches');
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load coaches');
  }
  return res.json();
}

export async function revokeCoach(coach_user_id) {
  const res = await apiFetch('/api/coach/revoke', {
    method: 'POST',
    body: JSON.stringify({ coach_user_id }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to revoke coach');
  }
  return res.json();
}

export async function fetchRoster() {
  const res = await apiFetch('/api/coach/roster');
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load roster');
  }
  return res.json();
}

export async function fetchClientLog(clientId, start, end) {
  const qs = `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await apiFetch(`/api/coach/clients/${encodeURIComponent(clientId)}/log${qs}`);
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load client log');
  }
  return res.json();
}

export async function weeklySummary(clientId) {
  const res = await apiFetch(`/api/coach/clients/${encodeURIComponent(clientId)}/weekly-summary`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load weekly summary');
  }
  return res.json();
}

export async function createClientSuggestion(clientId, body) {
  const res = await apiFetch(`/api/coach/clients/${encodeURIComponent(clientId)}/suggestions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to create suggestion');
  }
  return res.json();
}

export async function fetchClientSuggestions(clientId) {
  const res = await apiFetch(`/api/coach/clients/${encodeURIComponent(clientId)}/suggestions`);
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load suggestions');
  }
  return res.json();
}

export async function fetchMySuggestions(date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await apiFetch(`/api/coach/suggestions${qs}`);
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load suggestions');
  }
  return res.json();
}

export async function patchSuggestion(id, body) {
  const res = await apiFetch(`/api/coach/suggestions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to update suggestion');
  }
  return res.json();
}
