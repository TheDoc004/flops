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
  wrapWithAuth,
  authHeader,
  createUser,
  createDb,
};
