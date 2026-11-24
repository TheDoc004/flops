const express = require('express');
const { uid } = require('../userId');
const {
  GOAL_FIELDS,
  normalizeRangePair,
  goalsForDate,
  listVersions,
  upsertVersionRows,
} = require('../goals');

function normalizeIsoDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getLocalDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createGoalsRouter(db) {
  const router = express.Router();

  function buildPayload(userId, resolvedForDate = getLocalDateISO()) {
    const { effective_start_date, goals } = goalsForDate(db, userId, resolvedForDate);
    return {
      user_id: userId,
      resolved_for_date: resolvedForDate,
      effective_start_date,
      goals,
      versions: listVersions(db, userId),
    };
  }

  router.get('/', (req, res) => {
    const userId = uid(req);
    const date = normalizeIsoDate(req.query.date) || getLocalDateISO();
    res.json(buildPayload(userId, date));
  });

  router.put('/', (req, res) => {
    const userId = uid(req);
    const effectiveStartDate = normalizeIsoDate(req.body?.effective_start_date) || getLocalDateISO();
    const { goals } = req.body;
    if (!Array.isArray(goals)) {
      return res.status(400).json({ error: 'Body must include goals: array' });
    }

    const normalized = [];
    const seen = new Set();
    try {
      for (const g of goals) {
        const wd = Number(g?.weekday);
        if (!Number.isInteger(wd) || wd < 1 || wd > 7) {
          return res.status(400).json({ error: 'Each goal needs weekday 1–7 (Mon–Sun)' });
        }
        if (seen.has(wd)) {
          return res.status(400).json({ error: `Duplicate weekday ${wd}` });
        }
        seen.add(wd);

        const row = { weekday: wd };
        for (const key of GOAL_FIELDS) {
          const pair = normalizeRangePair(g, key);
          row[`${key}_min`] = pair.min;
          row[`${key}_max`] = pair.max;
        }
        normalized.push(row);
      }
    } catch (e) {
      if (e.code === 'INVALID_RANGE') {
        return res.status(400).json({ error: e.message });
      }
      throw e;
    }

    db.transaction(() => upsertVersionRows(db, userId, effectiveStartDate, normalized, 'app'))();

    res.json(buildPayload(userId, effectiveStartDate));
  });

  return router;
}

module.exports = { createGoalsRouter };
