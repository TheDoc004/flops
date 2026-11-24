const express = require('express');
const { uid } = require('../userId');
const { exportNutrition, softDeleteNutrition } = require('../nutritionExport');
const { exportGym, softDeleteGym } = require('../gymExport');
const { startAccountDeleteChallenge, consumeAccountDeleteChallenge } = require('../authService');
const { mailConfigured, sendOtpEmail } = require('../mail');

const EXPORT_VERSION = 2;
const REPORT_COLUMNS = 'id, user_id, text, route, app_version, created_at, status';

function devMode() {
  return process.env.AUTH_DEV === '1' || !!process.env.JEST_WORKER_ID;
}

/**
 * GET /export — the signed-in user's own rows as one JSON download.
 * Coach links and suggestions appear as ids, scopes and the text itself only:
 * a link never pulls the other side's name, email or data into the file.
 *
 * POST /delete-request + DELETE / — delete the account. The delete needs a
 * fresh one-time confirmation (an emailed code, or an Apple re-sign-in for
 * accounts without an email); see deleteAccount for what it does.
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

    const coachSuggestions = db
      .prepare(
        `SELECT id, coach_user_id, client_user_id, for_date, status, note, payload_json,
                created_at, responded_at
           FROM coach_day_suggestions
          WHERE coach_user_id = ? OR client_user_id = ?
          ORDER BY id`
      )
      .all(userId, userId);

    const mcpWrites = db
      .prepare('SELECT * FROM mcp_write_audit WHERE user_id = ? ORDER BY id')
      .all(userId);

    const problemReports = db
      .prepare(`SELECT ${REPORT_COLUMNS} FROM problem_reports WHERE user_id = ? ORDER BY id`)
      .all(userId);

    const exportedAt = new Date().toISOString();
    const role = row => (row.coach_user_id === userId ? 'coach' : 'client');
    const body = {
      format: 'flops-export',
      version: EXPORT_VERSION,
      exported_at: exportedAt,
      account,
      nutrition: exportNutrition(db, userId),
      training: exportGym(db, userId),
      coach_links: coachLinks.map(l => ({ ...l, role: role(l) })),
      coach_suggestions: coachSuggestions.map(s => ({ ...s, role: role(s) })),
      mcp_writes: mcpWrites,
      problem_reports: problemReports,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="flops-export-${exportedAt.slice(0, 10)}.json"`
    );
    res.json(body);
  });

  router.post('/delete-request', async (req, res) => {
    const userId = uid(req);
    const user = db.prepare('SELECT id, email, apple_sub FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (!user.email) {
      // No inbox to send a code to: the client re-signs in with Apple and
      // sends this challenge back with it.
      const challenge = startAccountDeleteChallenge(db, userId, 'apple');
      return res.json({ ok: true, method: 'apple', challenge });
    }

    if (!devMode() && !mailConfigured()) {
      return res.status(503).json({ error: 'Email is not set up on this server yet, so the code cannot be sent.' });
    }
    const code = startAccountDeleteChallenge(db, userId, 'email');
    const payload = { ok: true, method: 'email', message: 'Check your email for a 6-digit code.' };
    if (devMode()) payload.dev_code = code;
    if (mailConfigured()) {
      try {
        await sendOtpEmail(user.email, code, { purpose: 'delete' });
      } catch (e) {
        if (!devMode()) {
          console.error('[me] delete code email failed:', e.message);
          return res.status(e.status || 502).json({ error: 'Could not send the code. Try again in a few minutes.' });
        }
      }
    }
    res.json(payload);
  });

  router.delete('/', (req, res) => {
    const userId = uid(req);
    const user = db.prepare('SELECT id, email, apple_sub FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    let method;
    if (user.email) {
      method = 'email';
      if (!consumeAccountDeleteChallenge(db, userId, 'email', String(req.body?.code || '').trim())) {
        // 403, not 401: the client treats 401 as "signed out", and a typo must not sign anyone out.
        return res.status(403).json({ error: 'That code is wrong or has expired. Ask for a new one.' });
      }
    } else {
      method = 'apple';
      // Same rule as /api/auth/apple: no production Apple token check yet,
      // so only the dev payload can confirm, and only for the same Apple id.
      if (req.body?.identity_token || !devMode()) {
        return res.status(501).json({ error: 'Confirming with Apple is not available here yet.' });
      }
      const appleSub = String(req.body?.apple_sub || '').trim();
      const challenge = String(req.body?.challenge || '').trim();
      if (!appleSub || appleSub !== user.apple_sub
          || !consumeAccountDeleteChallenge(db, userId, 'apple', challenge)) {
        return res.status(403).json({ error: 'Sign in with Apple again to confirm.' });
      }
    }

    deleteAccount(db, userId, method);
    res.json({ ok: true, message: 'Your account is deleted. You have been signed out.' });
  });

  return router;
}

/**
 * Soft-deletes the account and everything that hangs off it, in one transaction:
 * flags the user's own rows (nutrition and training, each from its own module),
 * ends coach links both ways, signs out every session, and records the audit row.
 * Nothing is hard-deleted except sessions and pending codes, which are credentials.
 */
function deleteAccount(db, userId, method) {
  const run = db.transaction(() => {
    const now = new Date().toISOString();
    const linkIds = db
      .prepare(
        `SELECT id FROM coach_links
          WHERE (coach_user_id = ? OR client_user_id = ?) AND status = 'active' ORDER BY id`
      )
      .all(userId, userId)
      .map(r => r.id);
    db.prepare(
      `UPDATE coach_links SET status = 'revoked'
        WHERE (coach_user_id = ? OR client_user_id = ?) AND status = 'active'`
    ).run(userId, userId);

    const reportIds = db
      .prepare(`SELECT id FROM problem_reports WHERE user_id = ? AND status = 'new' ORDER BY id`)
      .all(userId)
      .map(r => r.id);
    db.prepare(`UPDATE problem_reports SET status = 'account_deleted' WHERE user_id = ? AND status = 'new'`)
      .run(userId);

    const flagged = {
      nutrition: softDeleteNutrition(db, userId),
      training: softDeleteGym(db, userId),
      coach_links: linkIds,
      problem_reports: reportIds,
    };

    const email = db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email;
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM account_delete_challenges WHERE user_id = ?').run(userId);
    if (email) db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, userId);
    db.prepare(
      'INSERT INTO account_deletions (user_id, method, flagged_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(userId, method, JSON.stringify(flagged), now);
  });
  run();
}

module.exports = { createMeRouter, deleteAccount };
