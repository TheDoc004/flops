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

export async function fetchExerciseLibrary({ movement_type, muscle } = {}) {
  const params = new URLSearchParams();
  if (movement_type) params.set('movement_type', movement_type);
  if (muscle) params.set('muscle', muscle);
  const qs = params.toString();
  const res = await fetch(apiUrl(`/api/workouts/exercise-library${qs ? `?${qs}` : ''}`));
  if (!res.ok) throw new Error('Failed to load exercise library');
  return res.json();
}

export async function fetchWorkoutPresets() {
  const res = await fetch(apiUrl('/api/workouts/presets?user_id=0'));
  if (!res.ok) throw new Error('Failed to load presets');
  return res.json();
}

export async function createWorkoutPreset(body) {
  const res = await fetch(apiUrl('/api/workouts/presets'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...body }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to create preset');
  }
  return res.json();
}

export async function updateWorkoutPreset(id, body) {
  const res = await fetch(apiUrl(`/api/workouts/presets/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...body }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to update preset');
  }
  return res.json();
}

export async function deleteWorkoutPreset(id) {
  const res = await fetch(apiUrl(`/api/workouts/presets/${id}?user_id=0`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete preset');
  }
}

export async function fetchPresetExercises(presetId) {
  const res = await fetch(apiUrl(`/api/workouts/presets/${presetId}/exercises?user_id=0`));
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load exercises');
  }
  return res.json();
}

export async function addPresetExercise(presetId, body) {
  const res = await fetch(apiUrl(`/api/workouts/presets/${presetId}/exercises`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...body }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to add exercise');
  }
  return res.json();
}

export async function deletePresetExercise(id) {
  const res = await fetch(apiUrl(`/api/workouts/exercises/${id}?user_id=0`), { method: 'DELETE' });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to delete exercise');
  }
}

export async function fetchWorkoutToday(date) {
  const res = await fetch(apiUrl(`/api/workouts/today?user_id=0&date=${encodeURIComponent(date)}`));
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load today workout');
  }
  return res.json();
}

export async function setWorkoutToday(date, preset_id) {
  const res = await fetch(apiUrl('/api/workouts/today'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, date, preset_id }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to set today workout');
  }
  return res.json();
}

export async function fetchPreviousSessionLogs(names) {
  if (!names || names.length === 0) return {};
  const res = await fetch(apiUrl(`/api/workouts/logs/previous?user_id=0&names=${encodeURIComponent(names.join(','))}`));
  if (!res.ok) throw new Error('Failed to load previous session');
  return res.json();
}

export async function createExerciseLog(body) {
  const res = await fetch(apiUrl('/api/workouts/logs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 0, ...body }),
  });
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to save log');
  }
  return res.json();
}

export async function fetchExerciseProgress(exercise_name) {
  const res = await fetch(apiUrl(`/api/workouts/progress?user_id=0&exercise_name=${encodeURIComponent(exercise_name)}`));
  if (!res.ok) {
    const e = await readJsonIfPresent(res);
    throw new Error(e?.error || 'Failed to load progress');
  }
  return res.json();
}

