const express = require('express');
const { uid } = require('../userId');
const { getLocalDateISO } = require('../mcp/dates');
const {
  isIsoDate,
  getPhase,
  createPhase,
  updatePhase,
  setPhaseDeleted,
  listPhases,
} = require('../dietPhases');

/**
 * Diet phases (calendar badges). Storage + "ongoing" resolution live in
 * server/dietPhases.js, shared with the MCP tools.
 *
 * `today` may be passed by the client so an ongoing phase is capped at the
 * user's own date rather than the server's.
 */
function createDietPhasesRouter(db) {
  const router = express.Router();

  const todayFrom = req => (isIsoDate(req.query.today) ? req.query.today : getLocalDateISO());

  router.get('/', (req, res) => {
    const { start, end } = req.query;
    if ((start && !isIsoDate(start)) || (end && !isIsoDate(end))) {
      return res.status(400).json({ error: 'start/end must be YYYY-MM-DD' });
    }
    res.json(listPhases(db, uid(req), { start: start || null, end: end || null, today: todayFrom(req) }));
  });

  router.post('/', (req, res) => {
    const r = createPhase(db, uid(req), req.body || {}, 'app');
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(r.phase);
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const r = updatePhase(db, uid(req), id, req.body || {}, 'app');
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r.after);
  });

  router.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    if (!getPhase(db, userId, id)) return res.status(404).json({ error: 'Diet phase not found' });
    setPhaseDeleted(db, userId, id, true);
    res.status(204).send();
  });

  return router;
}

module.exports = { createDietPhasesRouter };
