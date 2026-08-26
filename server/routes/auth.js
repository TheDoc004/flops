const express = require('express');
const {
  storeOtp,
  verifyOtp,
  randomOtp,
  findOrCreateEmailUser,
  findOrCreateAppleUser,
  createSession,
  publicUser,
  randomInviteCode,
} = require('../authService');
const { mailConfigured, sendOtpEmail } = require('../mail');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/request-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid email.' });
    }
    const code = randomOtp();
    storeOtp(db, email, code);
    const payload = { ok: true, message: 'Check your email for a 6-digit code.' };

    // Dev / Jest: return the code so local login works without a mailer.
    if (process.env.AUTH_DEV === '1' || process.env.JEST_WORKER_ID) {
      payload.dev_code = code;
      // Still try to send when a mailer is configured (useful for testing Resend).
      if (mailConfigured()) {
        try {
          await sendOtpEmail(email, code);
        } catch (e) {
          console.warn('[auth] OTP email failed (dev continues with dev_code):', e.message);
        }
      }
      return res.json(payload);
    }

    if (!mailConfigured()) {
      console.warn('[auth] OTP stored but RESEND_API_KEY / SMTP_URL unset.');
      return res.status(503).json({
        error: 'Email login is not configured on this server. Set RESEND_API_KEY or SMTP_URL.',
      });
    }

    try {
      await sendOtpEmail(email, code);
      return res.json(payload);
    } catch (e) {
      console.error('[auth] OTP email failed:', e.message);
      return res.status(e.status || 502).json({
        error:
          'Could not send your login code yet. Email delivery may still be setting up. Try again in a few minutes.',
      });
    }
  });

  router.post('/verify-otp', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!email || !code) return res.status(400).json({ error: 'Email and code required.' });
    if (!verifyOtp(db, email, code)) {
      return res.status(401).json({ error: 'Invalid or expired code.' });
    }
    const user = findOrCreateEmailUser(db, email);
    const session = createSession(db, user.id);
    res.json({ token: session.token, expires_at: session.expires_at, user: publicUser(user) });
  });

  /**
   * Sign in with Apple. Production should verify the identity token with Apple's JWKS.
   * Until APPLE_CLIENT_ID is configured, accept a trusted dev payload
   * `{ apple_sub, email?, display_name? }` when AUTH_DEV=1.
   */
  router.post('/apple', (req, res) => {
    const apple_sub = String(req.body?.apple_sub || req.body?.sub || '').trim();
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
    const display_name = req.body?.display_name ? String(req.body.display_name).trim() : null;
    const identityToken = req.body?.identity_token || req.body?.identityToken;

    if (!apple_sub && !identityToken) {
      return res.status(400).json({ error: 'Apple sign-in payload required.' });
    }

    // Full JWT verification lands with Capacitor / APPLE_CLIENT_ID.
    if (identityToken && process.env.APPLE_CLIENT_ID) {
      // Placeholder: treat identityToken as opaque until native verify is wired.
      return res.status(501).json({
        error: 'Apple token verification is configured for native builds. Use email OTP on web for now, or AUTH_DEV apple_sub.',
      });
    }

    if (!apple_sub) {
      return res.status(400).json({ error: 'apple_sub is required in development Sign in with Apple.' });
    }
    if (!process.env.AUTH_DEV && !process.env.JEST_WORKER_ID) {
      return res.status(503).json({
        error: 'Sign in with Apple is available in the iOS app. Use email on web, or set AUTH_DEV=1 for local testing.',
      });
    }

    const user = findOrCreateAppleUser(db, { apple_sub, email, display_name });
    const session = createSession(db, user.id);
    res.json({ token: session.token, expires_at: session.expires_at, user: publicUser(user) });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    res.json({ user: publicUser(req.user) });
  });

  router.post('/logout', (req, res) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1].trim());
    res.json({ ok: true });
  });

  router.patch('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    const id = req.user.id;
    if (Object.prototype.hasOwnProperty.call(req.body, 'display_name')) {
      const name = String(req.body.display_name || '').trim().slice(0, 80);
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name || null, id);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'is_coach')) {
      const isCoach = req.body.is_coach === true || req.body.is_coach === 1 || req.body.is_coach === '1' ? 1 : 0;
      db.prepare('UPDATE users SET is_coach = ? WHERE id = ?').run(isCoach, id);
      if (isCoach) {
        const u = db.prepare('SELECT invite_code FROM users WHERE id = ?').get(id);
        if (!u?.invite_code) {
          db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(randomInviteCode(), id);
        }
        // Solo org for coach tools
        const existing = db.prepare('SELECT id FROM organizations WHERE owner_user_id = ?').get(id);
        if (!existing) {
          const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || 'My coaching';
          const r = db.prepare('INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)').run(name, id);
          db.prepare('INSERT INTO org_memberships (org_id, user_id, role) VALUES (?, ?, ?)').run(
            r.lastInsertRowid,
            id,
            'coach'
          );
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'onboarding_completed')) {
      if (req.body.onboarding_completed) {
        db.prepare('UPDATE users SET onboarding_completed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      }
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json({ user: publicUser(user) });
  });

  return router;
}

module.exports = { createAuthRouter };
