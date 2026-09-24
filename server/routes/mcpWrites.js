const express = require('express');
const writes = require('../mcp/writes');

function uid(req) {
  return req.user?.id;
}

function createMcpWritesRouter(db) {
  const router = express.Router();

  /** Recent MCP-sourced meals/foods + audit (for banner + bulk undo). */
  router.get('/recent', (req, res) => {
    const userId = uid(req);
    const days = req.query.days != null ? Number(req.query.days) : 1;
    res.json(writes.listRecentMcpWrites(db, userId, days));
  });

  /** Multi-select delete of MCP-sourced log entries only. */
  router.post('/bulk-delete', (req, res) => {
    const userId = uid(req);
    const logIds = Array.isArray(req.body?.log_entry_ids) ? req.body.log_entry_ids : [];
    const foodIds = Array.isArray(req.body?.label_ingredient_ids)
      ? req.body.label_ingredient_ids
      : [];
    const meals = writes.bulkDeleteMcpLogEntries(db, userId, logIds);
    const foods = writes.bulkDeleteMcpFoods(db, userId, foodIds);
    res.json({ meals, foods });
  });

  return router;
}

module.exports = { createMcpWritesRouter };
