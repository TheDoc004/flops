/**
 * MCP connector auth — static credential from env, mapped to one FLOPS user.
 *
 * MCP_API_TOKEN  — required for /mcp to accept requests
 * MCP_USER_ID     — optional; defaults to the first users.id (owner)
 *
 * Accepted credentials (either works):
 *   Authorization: Bearer <MCP_API_TOKEN>
 *   x-api-key: <MCP_API_TOKEN>
 *
 * Prefer x-api-key in Claude's "Request headers" UI — using Authorization there
 * can make Claude incorrectly start an OAuth flow.
 */

function resolveMcpUserId(db) {
  const raw = process.env.MCP_USER_ID;
  if (raw != null && String(raw).trim() !== '') {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: 'MCP_USER_ID must be a positive integer' };
    }
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!row) return { error: `MCP_USER_ID ${id} not found` };
    return { userId: id };
  }
  const owner = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (!owner) return { error: 'No users in database; sign up in FLOPS first' };
  return { userId: owner.id };
}

function extractBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function extractApiKeyHeader(req) {
  const h = req.headers?.['x-api-key'] || req.headers?.['X-Api-Key'];
  if (!h || typeof h !== 'string') return null;
  return h.trim() || null;
}

function extractMcpCredential(req) {
  return extractBearerToken(req) || extractApiKeyHeader(req);
}

/**
 * Express middleware: require MCP_API_TOKEN via Bearer or x-api-key; attach req.mcpUserId.
 */
function createMcpAuthMiddleware(db) {
  return function mcpAuth(req, res, next) {
    const expected = process.env.MCP_API_TOKEN;
    if (!expected || !String(expected).trim()) {
      return res.status(503).json({
        error: 'MCP is not configured. Set MCP_API_TOKEN on the API service.',
      });
    }
    const token = extractMcpCredential(req);
    if (!token || token !== expected) {
      return res.status(401).json({
        error: 'Invalid or missing MCP credential. Send Authorization: Bearer <token> or x-api-key: <token>.',
      });
    }
    const resolved = resolveMcpUserId(db);
    if (resolved.error) {
      return res.status(503).json({ error: resolved.error });
    }
    req.mcpUserId = resolved.userId;
    return next();
  };
}

module.exports = {
  resolveMcpUserId,
  extractBearerToken,
  extractApiKeyHeader,
  extractMcpCredential,
  createMcpAuthMiddleware,
};
