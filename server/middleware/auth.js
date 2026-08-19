const { userFromToken, checkAiQuota, bumpAiUsage } = require('../authService');

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/**
 * Attach req.user from Bearer token.
 * In Jest / FLOPS_TEST_AUTH, missing token falls back to the first user (id 1 / owner).
 */
function createAuthMiddleware(db) {
  function attachUser(req, _res, next) {
    const token = extractBearer(req);
    let user = userFromToken(db, token);
    if (!user && (process.env.JEST_WORKER_ID || process.env.FLOPS_TEST_AUTH === '1')) {
      user = db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }
    if (user) req.user = user;
    next();
  }

  function requireAuth(req, res, next) {
    attachUser(req, res, () => {
      if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
      next();
    });
  }

  /** Sliding window rate limit per IP (and user when present). */
  const hits = new Map();
  function rateLimit({ windowMs = 60_000, max = 120 } = {}) {
    return (req, res, next) => {
      const key = `${req.ip || 'ip'}:${req.user?.id || 0}:${req.path}`;
      const now = Date.now();
      let bucket = hits.get(key);
      if (!bucket || now - bucket.start > windowMs) {
        bucket = { start: now, count: 0 };
        hits.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return res.status(429).json({ error: 'Too many requests. Slow down.' });
      }
      next();
    };
  }

  function aiGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    try {
      checkAiQuota(db, req.user.id);
    } catch (e) {
      return res.status(e.status || 429).json({ error: e.message });
    }
    const origJson = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try { bumpAiUsage(db, req.user.id); } catch { /* */ }
      }
      return origJson(body);
    };
    next();
  }

  return { attachUser, requireAuth, rateLimit, aiGuard };
}

module.exports = { createAuthMiddleware, extractBearer };
