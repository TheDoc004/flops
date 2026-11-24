const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createApp } = require('../createApp');
const { createSession, findOrCreateEmailUser } = require('../authService');

/** Full app with in-memory DB (preferred for route tests). */
function buildTestApp() {
  const db = createDb(':memory:');
  const app = createApp(db, { cors: false });
  return { app, db };
}

/**
 * Listens once on 127.0.0.1 for supertest to reuse. `request(app)` instead opens
 * a server per request on `::` and then dials 127.0.0.1 — on macOS that can land
 * on a port another local process holds on 127.0.0.1, and the request is reset
 * ("socket hang up"). Close it with closeTestServer().
 */
function listenTestServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function closeTestServer(server) {
  if (!server) return Promise.resolve();
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

/**
 * Mini app: attach Jest owner fallback + one router.
 * Prefer buildTestApp() when possible.
 */
function wrapWithAuth(db, mountPath, router) {
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use(mountPath, router);
  return app;
}

function authHeader(db, userId) {
  const { token } = createSession(db, userId);
  return { Authorization: `Bearer ${token}` };
}

function createUser(db, email) {
  return findOrCreateEmailUser(db, email);
}

module.exports = {
  buildTestApp,
  listenTestServer,
  closeTestServer,
  wrapWithAuth,
  authHeader,
  createUser,
  createDb,
};
