/**
 * Resolve the authenticated user id for a request.
 * Client-supplied user_id in query/body is ignored (spoofing risk).
 */
function uid(req) {
  const id = Number(req.user?.id);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('UNAUTHORIZED');
    err.status = 401;
    throw err;
  }
  return id;
}

function uidOrNull(req) {
  const id = Number(req.user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { uid, uidOrNull };
