const express = require('express');
const { uid } = require('../userId');

function isoDateOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizeOptionalString(raw, maxLen = 140) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeName(raw, maxLen = 64) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeOptionalNumber(raw, { min = 0, max = 10000 } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function normalizeOptionalInt(raw, { min = 0, max = 10000 } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

const VALID_MOVEMENT_TYPES = new Set(['push', 'pull', 'legs', 'core', 'cardio']);
const VALID_MUSCLES = new Set([
  'chest', 'shoulders', 'triceps', 'back', 'biceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio',
]);

function createWorkoutsRouter(db) {
  const router = express.Router();

  // Exercise library
  router.get('/exercise-library', (req, res) => {
    const { movement_type, muscle } = req.query;
    const clauses = [];
    const params = [];
    if (movement_type && VALID_MOVEMENT_TYPES.has(movement_type)) {
      clauses.push('movement_type = ?');
      params.push(movement_type);
    }
    if (muscle && VALID_MUSCLES.has(muscle)) {
      clauses.push('(primary_muscle = ? OR secondary_muscles LIKE ?)');
      params.push(muscle, `%"${muscle}"%`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT id, name, primary_muscle, secondary_muscles, movement_type, equipment FROM exercise_library${where} ORDER BY movement_type, primary_muscle, name`)
      .all(...params)
      .map(r => ({ ...r, secondary_muscles: JSON.parse(r.secondary_muscles || '[]') }));
    res.json(rows);
  });

  // Presets
  router.get('/presets', (req, res) => {
    const userId = uid(req);
    const rows = db
      .prepare(
        `SELECT id, name, intensity_label, notes
           FROM workout_presets
          WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0
          ORDER BY name`
      )
      .all(userId);
    res.json(rows);
  });

  router.post('/presets', (req, res) => {
    const userId = uid(req);
    const name = normalizeName(req.body?.name, 64);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const intensity_label = normalizeOptionalString(req.body?.intensity_label, 24);
    const notes = normalizeOptionalString(req.body?.notes, 300);

    const r = db
      .prepare(
        `INSERT INTO workout_presets (user_id, name, intensity_label, notes, is_deleted)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(userId, name, intensity_label, notes);

    const row = db
      .prepare('SELECT id, name, intensity_label, notes FROM workout_presets WHERE id = ?')
      .get(r.lastInsertRowid);
    res.status(201).json(row);
  });

  router.put('/presets/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT id FROM workout_presets WHERE id = ? AND user_id = ? AND COALESCE(is_deleted,0)=0').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const name = normalizeName(req.body?.name, 64);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const intensity_label = normalizeOptionalString(req.body?.intensity_label, 24);
    const notes = normalizeOptionalString(req.body?.notes, 300);

    db.prepare('UPDATE workout_presets SET name=?, intensity_label=?, notes=? WHERE id=? AND user_id=?')
      .run(name, intensity_label, notes, id, userId);

    res.json(db.prepare('SELECT id, name, intensity_label, notes FROM workout_presets WHERE id = ?').get(id));
  });

  router.delete('/presets/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const existing = db.prepare('SELECT id FROM workout_presets WHERE id = ? AND user_id = ? AND COALESCE(is_deleted,0)=0').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE workout_presets SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(id, userId);
    res.status(204).send();
  });

  // Exercises within a preset
  router.get('/presets/:id/exercises', (req, res) => {
    const userId = uid(req);
    const presetId = Number(req.params.id);
    if (!Number.isInteger(presetId) || presetId <= 0) return res.status(400).json({ error: 'Invalid preset id' });
    const preset = db.prepare('SELECT id FROM workout_presets WHERE id = ? AND user_id = ? AND COALESCE(is_deleted,0)=0').get(presetId, userId);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    const rows = db
      .prepare(
        `SELECT id, preset_id, name, sort_order
           FROM workout_preset_exercises
          WHERE user_id = ? AND preset_id = ?
          ORDER BY sort_order, id`
      )
      .all(userId, presetId);
    res.json(rows);
  });

  router.post('/presets/:id/exercises', (req, res) => {
    const userId = uid(req);
    const presetId = Number(req.params.id);
    if (!Number.isInteger(presetId) || presetId <= 0) return res.status(400).json({ error: 'Invalid preset id' });
    const preset = db.prepare('SELECT id FROM workout_presets WHERE id = ? AND user_id = ? AND COALESCE(is_deleted,0)=0').get(presetId, userId);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    const name = normalizeName(req.body?.name, 64);
    if (!name) return res.status(400).json({ error: 'exercise name is required' });
    const sort_order = normalizeOptionalInt(req.body?.sort_order, { min: 0, max: 10_000 }) ?? 0;

    const r = db.prepare(
      `INSERT INTO workout_preset_exercises (user_id, preset_id, name, sort_order)
       VALUES (?, ?, ?, ?)`
    ).run(userId, presetId, name, sort_order);

    res.status(201).json(
      db.prepare('SELECT id, preset_id, name, sort_order FROM workout_preset_exercises WHERE id = ?').get(r.lastInsertRowid)
    );
  });

  router.delete('/exercises/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const r = db.prepare('DELETE FROM workout_preset_exercises WHERE id = ? AND user_id = ?').run(id, userId);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  // Today selection (by date)
  router.get('/today', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (YYYY-MM-DD)' });
    const row = db
      .prepare('SELECT date, preset_id, preset_name FROM workout_day_selections WHERE user_id = ? AND date = ?')
      .get(userId, date);
    res.json(row || { date, preset_id: null, preset_name: null });
  });

  router.put('/today', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (YYYY-MM-DD)' });

    const preset_id = req.body?.preset_id == null || req.body?.preset_id === '' ? null : Number(req.body.preset_id);
    if (preset_id != null && (!Number.isInteger(preset_id) || preset_id <= 0)) {
      return res.status(400).json({ error: 'preset_id must be null or a positive integer' });
    }

    let preset_name = null;
    if (preset_id != null) {
      const p = db.prepare('SELECT name FROM workout_presets WHERE id = ? AND user_id = ? AND COALESCE(is_deleted,0)=0').get(preset_id, userId);
      if (!p) return res.status(404).json({ error: 'Preset not found' });
      preset_name = p.name;
    }

    db.prepare(
      `INSERT INTO workout_day_selections (user_id, date, preset_id, preset_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET preset_id = excluded.preset_id, preset_name = excluded.preset_name`
    ).run(userId, date, preset_id, preset_name);

    res.json(db.prepare('SELECT date, preset_id, preset_name FROM workout_day_selections WHERE user_id=? AND date=?').get(userId, date));
  });

  // Logging
  router.post('/logs', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (YYYY-MM-DD)' });

    const exercise_name = normalizeName(req.body?.exercise_name, 80);
    if (!exercise_name) return res.status(400).json({ error: 'exercise_name is required' });

    const preset_id = req.body?.preset_id == null || req.body?.preset_id === '' ? null : Number(req.body.preset_id);
    if (preset_id != null && (!Number.isInteger(preset_id) || preset_id <= 0)) {
      return res.status(400).json({ error: 'preset_id must be null or a positive integer' });
    }

    const weight = normalizeOptionalNumber(req.body?.weight, { min: 0, max: 5000 });
    const weight_unit = normalizeOptionalString(req.body?.weight_unit, 8);
    const reps = normalizeOptionalInt(req.body?.reps, { min: 0, max: 500 });
    const sets = normalizeOptionalInt(req.body?.sets, { min: 0, max: 100 });

    let preset_name = null;
    if (preset_id != null) {
      const p = db.prepare('SELECT name FROM workout_presets WHERE id=? AND user_id=?').get(preset_id, userId);
      preset_name = p?.name ?? null;
    }

    const created_at = new Date().toISOString();

    const r = db.prepare(
      `INSERT INTO exercise_logs (user_id, date, preset_id, preset_name, exercise_name, weight, weight_unit, reps, sets, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, date, preset_id, preset_name, exercise_name, weight, weight_unit, reps, sets, created_at);

    res.status(201).json(
      db.prepare(
        `SELECT id, date, preset_id, preset_name, exercise_name, weight, weight_unit, reps, sets, created_at
           FROM exercise_logs WHERE id = ?`
      ).get(r.lastInsertRowid)
    );
  });

  router.get('/logs/previous', (req, res) => {
    const userId = uid(req);
    const raw = req.query.names;
    if (!raw || typeof raw !== 'string') return res.json({});
    const names = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
    if (names.length === 0) return res.json({});

    const placeholders = names.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT exercise_name, weight, weight_unit, reps, sets, date
         FROM (
           SELECT exercise_name, weight, weight_unit, reps, sets, date,
                  ROW_NUMBER() OVER (PARTITION BY exercise_name ORDER BY date DESC, id DESC) AS rn
             FROM exercise_logs
            WHERE user_id = ?
         )
        WHERE rn = 1 AND exercise_name IN (${placeholders})`
    ).all(userId, ...names);

    const result = {};
    for (const r of rows) result[r.exercise_name] = r;
    res.json(result);
  });

  router.get('/progress', (req, res) => {
    const userId = uid(req);
    const exercise = normalizeName(req.query.exercise_name, 80);
    if (!exercise) return res.status(400).json({ error: 'exercise_name is required' });

    const rows = db
      .prepare(
        `SELECT date, weight, weight_unit, reps, sets
           FROM exercise_logs
          WHERE user_id = ? AND lower(exercise_name) = lower(?)
          ORDER BY date ASC, id ASC`
      )
      .all(userId, exercise);
    res.json(rows);
  });

  return router;
}

module.exports = { createWorkoutsRouter };

