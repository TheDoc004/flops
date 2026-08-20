import { apiFetch } from './base';

async function readError(res, fallback) {
  try {
    const e = await res.json();
    throw new Error(e?.error || fallback);
  } catch (err) {
    if (err instanceof Error && err.message !== fallback) throw err;
    throw new Error(fallback);
  }
}

async function json(res, fallback) {
  if (!res.ok) await readError(res, fallback);
  return res.json();
}

export function fetchGymActivityTypes() {
  return apiFetch('/api/gym/activity-types').then(r => json(r, 'Failed to load activities'));
}

export function fetchGymExercises(params = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.muscle) qs.set('muscle', params.muscle);
  if (params.movement_type) qs.set('movement_type', params.movement_type);
  const s = qs.toString();
  return apiFetch(`/api/gym/exercises${s ? `?${s}` : ''}`).then(r => json(r, 'Failed to load exercises'));
}

export function createGymExercise(body) {
  return apiFetch('/api/gym/exercises', { method: 'POST', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to create exercise'));
}

export function fetchGymTemplates() {
  return apiFetch('/api/gym/templates').then(r => json(r, 'Failed to load workouts'));
}

export function createGymTemplate(body) {
  return apiFetch('/api/gym/templates', { method: 'POST', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to create workout'));
}

export function updateGymTemplate(id, body) {
  return apiFetch(`/api/gym/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to update workout'));
}

export function deleteGymTemplate(id) {
  return apiFetch(`/api/gym/templates/${id}`, { method: 'DELETE' })
    .then(r => json(r, 'Failed to delete workout'));
}

export function fetchTemplateExercises(id) {
  return apiFetch(`/api/gym/templates/${id}/exercises`).then(r => json(r, 'Failed to load exercises'));
}

export function addTemplateExercise(id, body) {
  return apiFetch(`/api/gym/templates/${id}/exercises`, { method: 'POST', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to add exercise'));
}

export function updateTemplateExercise(templateId, itemId, body) {
  return apiFetch(`/api/gym/templates/${templateId}/exercises/${itemId}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to update exercise'));
}

export function deleteTemplateExercise(templateId, itemId) {
  return apiFetch(`/api/gym/templates/${templateId}/exercises/${itemId}`, { method: 'DELETE' })
    .then(r => json(r, 'Failed to remove exercise'));
}

export function fetchGymSchedule() {
  return apiFetch('/api/gym/schedule').then(r => json(r, 'Failed to load schedule'));
}

export function saveGymSchedule(days) {
  return apiFetch('/api/gym/schedule', { method: 'PUT', body: JSON.stringify({ days }) })
    .then(r => json(r, 'Failed to save schedule'));
}

export function fetchGymToday(date) {
  return apiFetch(`/api/gym/today?date=${encodeURIComponent(date)}`).then(r => json(r, 'Failed to load today'));
}

export function startGymSession(body) {
  return apiFetch('/api/gym/sessions', { method: 'POST', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to start session'));
}

export function updateGymSession(id, body) {
  return apiFetch(`/api/gym/sessions/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to update session'));
}

export function logGymSet(sessionId, body) {
  return apiFetch(`/api/gym/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to log set'));
}

export function deleteGymSet(sessionId, setId) {
  return apiFetch(`/api/gym/sessions/${sessionId}/sets/${setId}`, { method: 'DELETE' })
    .then(r => json(r, 'Failed to delete set'));
}

export function fetchGymProgress(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') qs.set(k, String(v));
  });
  return apiFetch(`/api/gym/progress?${qs}`).then(r => json(r, 'Failed to load progress'));
}

export function fetchGymOneRm(exerciseId) {
  return apiFetch(`/api/gym/one-rm/${exerciseId}`).then(r => json(r, 'Failed to load 1RM'));
}

export function saveGymOneRm(exerciseId, body) {
  return apiFetch(`/api/gym/one-rm/${exerciseId}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(r => json(r, 'Failed to save 1RM'));
}
