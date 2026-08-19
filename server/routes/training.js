const express = require('express');
const { uid } = require('../userId');

/** ISO weekday: Monday = 1 … Sunday = 7 */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function normalizeOptionalString(raw, maxLen = 64) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeBoolInt(raw, defaultValue = 0) {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  if (raw === true || raw === 1 || raw === '1') return 1;
  return 0;
}

function normalizeOptionalInt(raw, { min = 0, max = 10_000 } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

function normalizeTimeMin(raw) {
  return normalizeOptionalInt(raw, { min: 0, max: 1439 });
}

function normalizeDurationMin(raw) {
  return normalizeOptionalInt(raw, { min: 5, max: 600 });
}

function isoDateOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

const DAILY_CONTEXT_TYPES = new Set([
  'rest',
  'light_cardio',
  'medium',
  'heavy_lifting',
  'heavy_cardio',
]);

function normalizeDailyContextType(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  return DAILY_CONTEXT_TYPES.has(t) ? t : null;
}

function timeMinToHHMM(timeMin) {
  if (timeMin == null) return null;
  const h = Math.floor(timeMin / 60);
  const m = timeMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function createTrainingRouter(db) {
  const router = express.Router();

  router.get('/daily-context', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const row = db
      .prepare('SELECT date, context_type FROM daily_training_context WHERE user_id = ? AND date = ?')
      .get(userId, date);
    res.json({
      date,
      context_type: row?.context_type ?? 'rest',
    });
  });

  router.put('/daily-context', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const context_type = normalizeDailyContextType(req.body?.context_type);
    if (!context_type) {
      return res.status(400).json({
        error: 'context_type must be one of: rest, light_cardio, medium, heavy_lifting, heavy_cardio',
      });
    }

    db.prepare(
      `INSERT INTO daily_training_context (user_id, date, context_type)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET context_type = excluded.context_type`
    ).run(userId, date, context_type);

    const row = db
      .prepare('SELECT date, context_type FROM daily_training_context WHERE user_id = ? AND date = ?')
      .get(userId, date);
    res.json(row);
  });

  router.get('/schedule', (req, res) => {
    const userId = uid(req);

    const rows = db
      .prepare(
        `SELECT ts.weekday, ts.enabled, ts.time_min, ts.workout_type, ts.duration_min,
                ts.preset_id, wp.name AS preset_name
           FROM training_schedule ts
           LEFT JOIN workout_presets wp ON wp.id = ts.preset_id AND COALESCE(wp.is_deleted, 0) = 0
          WHERE ts.user_id = ?
          ORDER BY ts.weekday`
      )
      .all(userId);
    const byDay = Object.fromEntries(rows.map(r => [r.weekday, r]));
    const schedule = WEEKDAYS.map(wd => {
      const r = byDay[wd];
      return {
        weekday: wd,
        enabled: r ? (r.enabled ? 1 : 0) : 0,
        time_min: r?.time_min ?? null,
        time_hhmm: timeMinToHHMM(r?.time_min ?? null),
        workout_type: r?.workout_type ?? null,
        duration_min: r?.duration_min ?? null,
        preset_id: r?.preset_id ?? null,
        preset_name: r?.preset_name ?? null,
      };
    });

    res.json({ user_id: userId, schedule });
  });

  router.put('/schedule', (req, res) => {
    const userId = uid(req);
    const { schedule } = req.body || {};
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ error: 'Body must include schedule: array' });
    }

    const seen = new Set();
    const upsert = db.prepare(`
      INSERT INTO training_schedule (user_id, weekday, enabled, time_min, workout_type, duration_min, preset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, weekday) DO UPDATE SET
        enabled = excluded.enabled,
        time_min = excluded.time_min,
        workout_type = excluded.workout_type,
        duration_min = excluded.duration_min,
        preset_id = excluded.preset_id
    `);

    for (const row of schedule) {
      const weekday = Number(row?.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        return res.status(400).json({ error: 'Each schedule row needs weekday 1–7 (Mon–Sun)' });
      }
      if (seen.has(weekday)) return res.status(400).json({ error: `Duplicate weekday ${weekday}` });
      seen.add(weekday);

      const enabled = normalizeBoolInt(row.enabled, 0);
      const time_min = normalizeTimeMin(row.time_min);
      const duration_min = normalizeDurationMin(row.duration_min);
      const workout_type = normalizeOptionalString(row.workout_type, 64);
      const preset_id = row.preset_id == null || row.preset_id === '' ? null : Number(row.preset_id);
      if (preset_id != null && (!Number.isInteger(preset_id) || preset_id <= 0)) {
        return res.status(400).json({ error: `weekday ${weekday}: preset_id must be null or a positive integer` });
      }

      upsert.run(userId, weekday, enabled, time_min, workout_type, duration_min, preset_id);
    }

    res.json(
      db
        .prepare(
          `SELECT ts.weekday, ts.enabled, ts.time_min, ts.workout_type, ts.duration_min,
                  ts.preset_id, wp.name AS preset_name
             FROM training_schedule ts
             LEFT JOIN workout_presets wp ON wp.id = ts.preset_id AND COALESCE(wp.is_deleted, 0) = 0
            WHERE ts.user_id = ?
            ORDER BY ts.weekday`
        )
        .all(userId)
    );
  });

  router.get('/override', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const row = db
      .prepare(
        'SELECT date, enabled, time_min, workout_type, duration_min FROM training_overrides WHERE user_id = ? AND date = ?'
      )
      .get(userId, date);
    res.json(
      row
        ? {
            ...row,
            enabled: row.enabled ? 1 : 0,
            time_hhmm: timeMinToHHMM(row.time_min),
          }
        : null
    );
  });

  router.put('/override', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const enabled = normalizeBoolInt(req.body?.enabled, 1);
    const time_min = normalizeTimeMin(req.body?.time_min);
    const duration_min = normalizeDurationMin(req.body?.duration_min);
    const workout_type = normalizeOptionalString(req.body?.workout_type, 64);

    db.prepare(`
      INSERT INTO training_overrides (user_id, date, enabled, time_min, workout_type, duration_min)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        enabled = excluded.enabled,
        time_min = excluded.time_min,
        workout_type = excluded.workout_type,
        duration_min = excluded.duration_min
    `).run(userId, date, enabled, time_min, workout_type, duration_min);

    const row = db
      .prepare(
        'SELECT date, enabled, time_min, workout_type, duration_min FROM training_overrides WHERE user_id = ? AND date = ?'
      )
      .get(userId, date);
    res.json({ ...row, enabled: row.enabled ? 1 : 0, time_hhmm: timeMinToHHMM(row.time_min) });
  });

  router.delete('/override/:date', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.params.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const r = db.prepare('DELETE FROM training_overrides WHERE user_id = ? AND date = ?').run(userId, date);
    if (r.changes === 0) return res.status(404).json({ error: 'Override not found' });
    res.status(204).send();
  });

  router.get('/today', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const weekday = Number(req.query.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return res.status(400).json({ error: 'weekday is required (1–7)' });
    }

    const override = db
      .prepare(
        'SELECT date, enabled, time_min, workout_type, duration_min FROM training_overrides WHERE user_id = ? AND date = ?'
      )
      .get(userId, date);
    if (override) {
      return res.json({
        source: 'override',
        date,
        enabled: override.enabled ? 1 : 0,
        time_min: override.time_min ?? null,
        time_hhmm: timeMinToHHMM(override.time_min),
        workout_type: override.workout_type ?? null,
        duration_min: override.duration_min ?? null,
        preset_id: null,
        preset_name: null,
      });
    }

    const sched = db
      .prepare(
        `SELECT ts.enabled, ts.time_min, ts.workout_type, ts.duration_min,
                ts.preset_id, wp.name AS preset_name
           FROM training_schedule ts
           LEFT JOIN workout_presets wp ON wp.id = ts.preset_id AND COALESCE(wp.is_deleted, 0) = 0
          WHERE ts.user_id = ? AND ts.weekday = ?`
      )
      .get(userId, weekday);
    if (!sched || !sched.enabled) {
      return res.json({ source: 'none', date, enabled: 0, time_min: null, time_hhmm: null, workout_type: null, duration_min: null, preset_id: null, preset_name: null });
    }
    return res.json({
      source: 'schedule',
      date,
      enabled: 1,
      time_min: sched.time_min ?? null,
      time_hhmm: timeMinToHHMM(sched.time_min),
      workout_type: sched.workout_type ?? null,
      duration_min: sched.duration_min ?? null,
      preset_id: sched.preset_id ?? null,
      preset_name: sched.preset_name ?? null,
    });
  });

  router.get('/feedback', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const row = db
      .prepare('SELECT date, energy, stomach, performance, notes FROM training_feedback WHERE user_id = ? AND date = ?')
      .get(userId, date);
    res.json(row || null);
  });

  router.put('/feedback', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const energy = normalizeOptionalString(req.body?.energy, 16);
    const stomach = normalizeOptionalString(req.body?.stomach, 16);
    const performance = normalizeOptionalString(req.body?.performance, 16);
    const notes = normalizeOptionalString(req.body?.notes, 140);

    db.prepare(`
      INSERT INTO training_feedback (user_id, date, energy, stomach, performance, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        energy = excluded.energy,
        stomach = excluded.stomach,
        performance = excluded.performance,
        notes = excluded.notes
    `).run(userId, date, energy, stomach, performance, notes);

    res.json(
      db
        .prepare('SELECT date, energy, stomach, performance, notes FROM training_feedback WHERE user_id = ? AND date = ?')
        .get(userId, date)
    );
  });

  return router;
}

module.exports = { createTrainingRouter };

