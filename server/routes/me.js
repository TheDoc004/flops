const express = require('express');
const { uid } = require('../userId');
const { exportNutrition } = require('../nutritionExport');
const { exportGym } = require('../gymExport');

const EXPORT_VERSION = 1;

/**
 * GET /export — the signed-in user's own rows as one JSON download.
 * Coach links appear as ids and scopes only: a link never pulls the other
 * side's name, email or data into the file.
 */
function createMeRouter(db) {
  const router = express.Router();

  router.get('/export', (req, res) => {
    const userId = uid(req);
    const account = db
      .prepare(
        `SELECT id, email, display_name, is_coach, invite_code, onboarding_completed_at, created_at
           FROM users WHERE id = ?`
      )
      .get(userId);
    if (!account) return res.status(401).json({ error: 'Sign in required.' });

    const coachLinks = db
      .prepare(
        `SELECT id, coach_user_id, client_user_id, status,
                scope_nutrition, scope_training, scope_weight, created_at
           FROM coach_links
          WHERE coach_user_id = ? OR client_user_id = ?
          ORDER BY id`
      )
      .all(userId, userId);

    const mcpWrites = db
      .prepare('SELECT * FROM mcp_write_audit WHERE user_id = ? ORDER BY id')
      .all(userId);

    const exportedAt = new Date().toISOString();
    const body = {
      format: 'flops-export',
      version: EXPORT_VERSION,
      exported_at: exportedAt,
      account,
      nutrition: exportNutrition(db, userId),
      training: exportGym(db, userId),
      coach_links: coachLinks.map(l => ({
        ...l,
        role: l.coach_user_id === userId ? 'coach' : 'client',
      })),
      mcp_writes: mcpWrites,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="flops-export-${exportedAt.slice(0, 10)}.json"`
    );
    res.json(body);
  });

  return router;
}

module.exports = { createMeRouter };
