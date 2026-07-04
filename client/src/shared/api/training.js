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

export async function fetchDailyTrainingContext(date) {
  const res = await fetch(apiUrl(`/api/training/daily-context?date=${encodeURIComponent(date)}`));
  if (!res.ok) throw new Error('Failed to load daily training context');
  return res.json();
}

export async function saveDailyTrainingContext(payload) {
  const res = await fetch(apiUrl('/api/training/daily-context'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...payload }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save daily training context');
  }
  return res.json();
}

export async function fetchTrainingSchedule() {
  const res = await fetch(apiUrl('/api/training/schedule'));
  if (!res.ok) throw new Error('Failed to load training schedule');
  return res.json();
}

export async function saveTrainingSchedule(schedule) {
  const res = await fetch(apiUrl('/api/training/schedule'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, schedule }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save training schedule');
  }
  return res.json();
}

export async function fetchTrainingOverride(date) {
  const res = await fetch(apiUrl(`/api/training/override?date=${date}`));
  if (!res.ok) throw new Error('Failed to load today override');
  return res.json();
}

export async function saveTrainingOverride(payload) {
  const res = await fetch(apiUrl('/api/training/override'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...payload }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save override');
  }
  return res.json();
}

export async function deleteTrainingOverride(date) {
  const res = await fetch(apiUrl(`/api/training/override/${date}?user_id=0`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete override');
  }
}

export async function fetchTrainingToday({ date, weekday }) {
  const res = await fetch(apiUrl(`/api/training/today?date=${date}&weekday=${weekday}`));
  if (!res.ok) throw new Error('Failed to load today training');
  return res.json();
}

export async function fetchTrainingFeedback(date) {
  const res = await fetch(apiUrl(`/api/training/feedback?date=${date}`));
  if (!res.ok) throw new Error('Failed to load workout feedback');
  return res.json();
}

export async function saveTrainingFeedback(payload) {
  const res = await fetch(apiUrl('/api/training/feedback'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...payload }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save feedback');
  }
  return res.json();
}

