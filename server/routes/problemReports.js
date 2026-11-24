const crypto = require('crypto');
const express = require('express');
const { uid } = require('../userId');
const { resolveGitSha } = require('../buildInfo');

const MAX_TEXT = 2000;
const MAX_ROUTE = 200;
const REPORT_COLUMNS = 'id, user_id, text, route, app_version, created_at, status';

function tokensMatch(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST / — a signed-in user files a report.
 * GET  /  — reports-only inbox for the triage side. It is guarded by
 *           PROBLEM_REPORTS_TOKEN (x-api-key header), not a user session, so no
 *           account — the owner's included — can list other people's reports,
 *           and it only ever selects from problem_reports.
 *
 * Mounted before the /api session guard because the inbox has no session.
 */
function createProblemReportsRouter(db, { requireAuth, rateLimit }) {
  const router = express.Router();

  router.post('/', requireAuth, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    const userId = uid(req);
    const text = String(req.body?.text ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return res.status(400).json({ error: 'Tell us what went wrong.' });
    const rawRoute = String(req.body?.route ?? '').trim();
    // Path only: a query string could carry dates or ids the reporter didn't mean to send.
    const route = rawRoute.startsWith('/') ? rawRoute.split(/[?#]/)[0].slice(0, MAX_ROUTE) : null;
    const sha = resolveGitSha().git_sha;
    const app_version = sha ? sha.slice(0, 12) : null;

    const r = db
      .prepare(
        `INSERT INTO problem_reports (user_id, text, route, app_version, created_at, status)
         VALUES (?, ?, ?, ?, ?, 'new')`
      )
      .run(userId, text, route, app_version, new Date().toISOString());
    const row = db.prepare(`SELECT ${REPORT_COLUMNS} FROM problem_reports WHERE id = ?`).get(r.lastInsertRowid);
    res.status(201).json(row);
  });

  router.get('/', (req, res) => {
    const expected = String(process.env.PROBLEM_REPORTS_TOKEN || '').trim();
    if (!expected) {
      return res.status(503).json({ error: 'Report inbox is not configured.' });
    }
    const given = String(req.headers['x-api-key'] || '').trim();
    if (!given || !tokensMatch(given, expected)) {
      return res.status(401).json({ error: 'Invalid or missing x-api-key.' });
    }
    const rows = db
      .prepare(
        `SELECT ${REPORT_COLUMNS} FROM problem_reports
          WHERE status = 'new'
          ORDER BY created_at ASC, id ASC
          LIMIT 200`
      )
      .all();
    res.json(rows);
  });

  return router;
}

module.exports = { createProblemReportsRouter };
