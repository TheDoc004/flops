import { apiUrl } from './base';

export async function fetchLogForDate(date) {
  const res = await fetch(apiUrl(`/api/log?date=${date}`));
  if (!res.ok) throw new Error('Failed to fetch log');
  return res.json();
}

export async function fetchLogRange(start, end) {
  const res = await fetch(apiUrl(`/api/log?start=${start}&end=${end}`));
  if (!res.ok) throw new Error('Failed to fetch log range');
  return res.json();
}

export async function fetchLogDays({ limit = 60, offset = 0 } = {}) {
  const res = await fetch(apiUrl(`/api/log/days?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`));
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to fetch logged days');
  }
  return res.json();
}

export async function createLogEntry(data) {
  const res = await fetch(apiUrl('/api/log'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to log meal'); }
  return res.json();
}

export async function createQuickFoodLog(data) {
  const res = await fetch(apiUrl('/api/log/quick-food'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to quick add food');
  }
  return res.json();
}

export async function updateLogEntry(id, data) {
  const res = await fetch(apiUrl(`/api/log/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || 'Failed to update log entry');
  }
  return res.json();
}

export async function deleteLogEntry(id) {
  const res = await fetch(apiUrl(`/api/log/${id}`), { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete log entry');
}
