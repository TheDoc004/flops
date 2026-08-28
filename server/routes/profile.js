const express = require('express');
const { uid } = require('../userId');

const PROFILE_FIELDS = [
  'height_cm',
  'weight_kg',
  'age',
  'sex',
  'goal_weight_kg',
  'activity_level',
  'maintenance_calories',
  'macro_units',
  'body_units',
  'dash_weight_chart_enabled',
  'dash_weight_days',
  'dash_adherence_view',
  'dash_supplements_enabled',
  'dash_training_fuel_enabled',
  'dash_layout_json',
  'dash_weight_enabled',
  'dash_meals_enabled',
  'dash_weight_chart_card_enabled',
  'digestion_pref',
  'training_goal',
];

function normalizeOptionalNumber(v, { int = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return int ? Math.round(n) : n;
}

function normalizeSex(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).toLowerCase();
  if (['male', 'female', 'other'].includes(s)) return s;
  return null;
}

function normalizeMacroUnits(raw) {
  if (raw === null || raw === undefined || raw === '') return 'metric';
  const s = String(raw).toLowerCase();
  if (s === 'us') return 'us';
  return 'metric';
}

function normalizeDigestionPref(raw) {
  if (raw === null || raw === undefined || raw === '') return 'none';
  const s = String(raw).toLowerCase();
  if (['none', 'lower_fat', 'lower_fiber', 'sensitive'].includes(s)) return s;
  return 'none';
}

function normalizeAdherenceView(raw) {
  if (raw === null || raw === undefined || raw === '') return '7d';
  const s = String(raw).toLowerCase();
  if (['7d', '2w', '3w', 'calendar'].includes(s)) return s;
  return '7d';
}

function normalizeTrainingGoal(raw) {
  if (raw === null || raw === undefined || raw === '') return 'performance';
  const s = String(raw).toLowerCase();
  if (['performance', 'fat_loss', 'muscle_gain'].includes(s)) return s;
  return 'performance';
}

function normalizeField(key, raw) {
  switch (key) {
    case 'macro_units':
    case 'body_units':
      return normalizeMacroUnits(raw);
    case 'height_cm':
    case 'weight_kg':
    case 'goal_weight_kg':
    case 'maintenance_calories':
      return normalizeOptionalNumber(raw);
    case 'age':
      return normalizeOptionalNumber(raw, { int: true });
    case 'sex':
      return normalizeSex(raw);
    case 'activity_level':
      return raw === null || raw === undefined || raw === ''
        ? null
        : String(raw).slice(0, 64);
    case 'dash_weight_chart_enabled':
      if (raw === null || raw === undefined || raw === '') return 1;
      if (raw === true || raw === 1 || raw === '1') return 1;
      return 0;
    case 'dash_weight_days': {
      const n = Number(raw);
      if ([14, 30, 90].includes(n)) return n;
      return 30;
    }
    case 'dash_adherence_view':
      return normalizeAdherenceView(raw);
    case 'dash_supplements_enabled':
      if (raw === null || raw === undefined || raw === '') return 1;
      if (raw === true || raw === 1 || raw === '1') return 1;
      return 0;
    case 'dash_training_fuel_enabled':
      if (raw === null || raw === undefined || raw === '') return 1;
      if (raw === true || raw === 1 || raw === '1') return 1;
      return 0;
    case 'dash_weight_enabled':
    case 'dash_meals_enabled':
      if (raw === null || raw === undefined || raw === '') return 1;
      if (raw === true || raw === 1 || raw === '1') return 1;
      return 0;
    case 'dash_weight_chart_card_enabled':
      if (raw === null || raw === undefined || raw === '') return 0;
      if (raw === true || raw === 1 || raw === '1') return 1;
      return 0;
    case 'dash_layout_json':
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw === 'string') return raw;
      try {
        return JSON.stringify(raw);
      } catch {
        return null;
      }
    case 'digestion_pref':
      return normalizeDigestionPref(raw);
    case 'training_goal':
      return normalizeTrainingGoal(raw);
    default:
      return null;
  }
}

function createProfileRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = uid(req);
    let row = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
    if (!row) {
      row = {
        user_id: userId,
        height_cm: null,
        weight_kg: null,
        age: null,
        sex: null,
        goal_weight_kg: null,
        activity_level: null,
        maintenance_calories: null,
        macro_units: 'metric',
        body_units: 'metric',
        dash_weight_chart_enabled: 1,
        dash_weight_days: 30,
        dash_adherence_view: '7d',
        dash_supplements_enabled: 1,
        dash_training_fuel_enabled: 1,
        dash_layout_json: null,
        dash_weight_enabled: 1,
        dash_meals_enabled: 1,
        dash_weight_chart_card_enabled: 0,
        digestion_pref: 'none',
        training_goal: 'performance',
      };
    } else {
      if (row.dash_weight_chart_enabled == null) row.dash_weight_chart_enabled = 1;
      if (row.dash_weight_days == null) row.dash_weight_days = 30;
      if (!row.dash_adherence_view) row.dash_adherence_view = '7d';
      if (row.dash_supplements_enabled == null) row.dash_supplements_enabled = 1;
      if (row.dash_training_fuel_enabled == null) row.dash_training_fuel_enabled = 1;
      if (row.dash_weight_enabled == null) row.dash_weight_enabled = 1;
      if (row.dash_meals_enabled == null) row.dash_meals_enabled = 1;
      if (row.dash_weight_chart_card_enabled == null) row.dash_weight_chart_card_enabled = 0;
      if (!row.digestion_pref) row.digestion_pref = 'none';
      if (!row.training_goal) row.training_goal = 'performance';
    }
    res.json(row);
  });

  router.put('/', (req, res) => {
    const userId = uid(req);
    const existing = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId) || {
      user_id: userId,
      height_cm: null,
      weight_kg: null,
      age: null,
      sex: null,
      goal_weight_kg: null,
      activity_level: null,
      maintenance_calories: null,
      macro_units: 'metric',
      body_units: 'metric',
      dash_weight_chart_enabled: 1,
      dash_weight_days: 30,
      dash_adherence_view: '7d',
      dash_supplements_enabled: 1,
      dash_training_fuel_enabled: 1,
      digestion_pref: 'none',
      training_goal: 'performance',
    };
    const merged = { ...existing, user_id: userId };
    for (const key of PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        merged[key] = normalizeField(key, req.body[key]);
      }
    }

    db.prepare(`
      INSERT INTO user_profile (
        user_id, height_cm, weight_kg, age, sex, goal_weight_kg, activity_level, maintenance_calories, macro_units, body_units,
        dash_weight_chart_enabled, dash_weight_days, dash_adherence_view, dash_supplements_enabled,
        dash_training_fuel_enabled, dash_layout_json, dash_weight_enabled, dash_meals_enabled,
        dash_weight_chart_card_enabled, digestion_pref, training_goal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        age = excluded.age,
        sex = excluded.sex,
        goal_weight_kg = excluded.goal_weight_kg,
        activity_level = excluded.activity_level,
        maintenance_calories = excluded.maintenance_calories,
        macro_units = excluded.macro_units,
        body_units = excluded.body_units,
        dash_weight_chart_enabled = excluded.dash_weight_chart_enabled,
        dash_weight_days = excluded.dash_weight_days,
        dash_adherence_view = excluded.dash_adherence_view,
        dash_supplements_enabled = excluded.dash_supplements_enabled,
        dash_training_fuel_enabled = excluded.dash_training_fuel_enabled,
        dash_layout_json = excluded.dash_layout_json,
        dash_weight_enabled = excluded.dash_weight_enabled,
        dash_meals_enabled = excluded.dash_meals_enabled,
        dash_weight_chart_card_enabled = excluded.dash_weight_chart_card_enabled,
        digestion_pref = excluded.digestion_pref,
        training_goal = excluded.training_goal
    `).run(
      userId,
      merged.height_cm,
      merged.weight_kg,
      merged.age,
      merged.sex,
      merged.goal_weight_kg,
      merged.activity_level,
      merged.maintenance_calories,
      merged.macro_units ?? 'metric',
      merged.body_units ?? 'metric',
      merged.dash_weight_chart_enabled === 0 || merged.dash_weight_chart_enabled === false ? 0 : 1,
      (() => {
        const d = Number(merged.dash_weight_days);
        return [14, 30, 90].includes(d) ? d : 30;
      })(),
      normalizeAdherenceView(merged.dash_adherence_view),
      merged.dash_supplements_enabled === 0 || merged.dash_supplements_enabled === false ? 0 : 1,
      merged.dash_training_fuel_enabled === 0 || merged.dash_training_fuel_enabled === false ? 0 : 1,
      merged.dash_layout_json ?? null,
      merged.dash_weight_enabled === 0 || merged.dash_weight_enabled === false ? 0 : 1,
      merged.dash_meals_enabled === 0 || merged.dash_meals_enabled === false ? 0 : 1,
      merged.dash_weight_chart_card_enabled === 0 || merged.dash_weight_chart_card_enabled === false ? 0 : 1,
      normalizeDigestionPref(merged.digestion_pref),
      normalizeTrainingGoal(merged.training_goal)
    );

    res.json(db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId));
  });

  return router;
}

function createBodyWeightsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = uid(req);
    const { start, end } = req.query;
    let rows;
    if (start && end) {
      rows = db
        .prepare(
          'SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date'
        )
        .all(userId, start, end);
    } else {
      rows = db
        .prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? ORDER BY date')
        .all(userId);
    }
    res.json(rows);
  });

  router.put('/', (req, res) => {
    const userId = uid(req);
    const { date, weight_kg } = req.body;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    }
    const w = normalizeOptionalNumber(weight_kg);
    if (w == null) {
      return res.status(400).json({ error: 'weight_kg is required and must be a non-negative number' });
    }

    db.prepare(`
      INSERT INTO body_weights (user_id, date, weight_kg) VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg
    `).run(userId, date, w);

    res.json(db.prepare('SELECT date, weight_kg FROM body_weights WHERE user_id = ? AND date = ?').get(userId, date));
  });

  router.delete('/:date', (req, res) => {
    const userId = uid(req);
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const r = db.prepare('DELETE FROM body_weights WHERE user_id = ? AND date = ?').run(userId, date);
    if (r.changes === 0) return res.status(404).json({ error: 'Entry not found' });
    res.status(204).send();
  });

  return router;
}

module.exports = { createProfileRouter, createBodyWeightsRouter };
