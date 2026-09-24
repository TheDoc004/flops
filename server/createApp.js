const express = require('express');
const cors = require('cors');
const { createDb } = require('./db');
const { createAuthMiddleware } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createCoachRouter } = require('./routes/coach');
const { createRecipesRouter } = require('./routes/recipes');
const { createLogRouter } = require('./routes/log');
const { createGoalsRouter } = require('./routes/goals');
const { createProfileRouter, createBodyWeightsRouter } = require('./routes/profile');
const { createTrainingRouter } = require('./routes/training');
const { createLabelIngredientsRouter } = require('./routes/labelIngredients');
const { createWorkoutsRouter } = require('./routes/workouts');
const { createGymRouter } = require('./routes/gym');
const { createSupplementsRouter } = require('./routes/supplements');
const { createAiRouter } = require('./routes/ai');
const { createBarcodeRouter } = require('./routes/barcode');
const { createPrepRouter } = require('./routes/prep');
const { createPreppedBatchesRouter } = require('./routes/preppedBatches');
const { createMcpRouter } = require('./mcp/createMcpRouter');
const { createMcpWritesRouter } = require('./routes/mcpWrites');

/**
 * Build the Express app (used by index.js and tests).
 * @param {import('better-sqlite3').Database} [db]
 * @param {{ cors?: boolean }} [opts]
 */
function createApp(db = createDb(process.env.DB_PATH || './nutrition.db'), opts = {}) {
  const app = express();
  const { attachUser, requireAuth, rateLimit, aiGuard } = createAuthMiddleware(db);

  if (opts.cors !== false) {
    const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    app.use(
      cors({
        origin(origin, cb) {
          if (!origin) return cb(null, true);
          if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
          if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return cb(null, true);
          if (allowedOrigins.includes(origin)) return cb(null, true);
          return cb(new Error('Not allowed by CORS'));
        },
      })
    );
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(attachUser);

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Analyze-only MCP (Streamable HTTP). Own Bearer token — not session auth.
  app.use('/mcp', createMcpRouter(db));

  app.use('/api/auth', createAuthRouter(db));

  // All other /api/* require a session (Jest falls back to owner via attachUser).
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    return requireAuth(req, res, next);
  });

  app.use('/api', rateLimit({ windowMs: 60_000, max: 180 }));

  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  app.use('/api/log', createLogRouter(db));
  app.use('/api/goals', createGoalsRouter(db));
  app.use('/api/profile', createProfileRouter(db));
  app.use('/api/body-weights', createBodyWeightsRouter(db));
  app.use('/api/training', createTrainingRouter(db));
  app.use('/api/workouts', createWorkoutsRouter(db));
  app.use('/api/gym', createGymRouter(db));
  app.use('/api/supplements', createSupplementsRouter(db));
  app.use('/api/barcode', createBarcodeRouter(db));
  app.use('/api/coach', createCoachRouter(db));
  app.use('/api/prep', createPrepRouter(db));
  app.use('/api/prepped-batches', createPreppedBatchesRouter(db));
  app.use('/api/mcp-writes', createMcpWritesRouter(db));

  const ai = createAiRouter();
  app.use('/api/ai', rateLimit({ windowMs: 60_000, max: 40 }), aiGuard, ai);

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
