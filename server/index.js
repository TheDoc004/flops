const path = require('path');
// Load a local server/.env if present (real environment vars still win on Render etc.).
// process.loadEnvFile is built into Node 20.12+/21.7+ — no dotenv dependency needed.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* no .env file — rely on the process environment */
}

const express = require('express');
const cors = require('cors');
const { createDb } = require('./db');
const { createRecipesRouter } = require('./routes/recipes');
const { createLogRouter } = require('./routes/log');
const { createGoalsRouter } = require('./routes/goals');
const { createProfileRouter, createBodyWeightsRouter } = require('./routes/profile');
const { createTrainingRouter } = require('./routes/training');
const { createLabelIngredientsRouter } = require('./routes/labelIngredients');
const { createWorkoutsRouter } = require('./routes/workouts');
const { createSupplementsRouter } = require('./routes/supplements');
const { createAiRouter } = require('./routes/ai');

const db = createDb(process.env.DB_PATH || './nutrition.db');
const app = express();

// Production frontend origin(s) allowed via CORS. Comma-separated for multiple
// (e.g. preview + prod). Local dev origins are always allowed below.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl / server-to-server (no Origin header).
      if (!origin) return cb(null, true);
      // Local dev servers (any port).
      if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return cb(null, true);
      // Configured production origin(s).
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json({ limit: '1mb' }));

// Lightweight health check for deployment platforms.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/recipes', createRecipesRouter(db));
app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
app.use('/api/log', createLogRouter(db));
app.use('/api/goals', createGoalsRouter(db));
app.use('/api/profile', createProfileRouter(db));
app.use('/api/body-weights', createBodyWeightsRouter(db));
app.use('/api/training', createTrainingRouter(db));
app.use('/api/workouts', createWorkoutsRouter(db));
app.use('/api/supplements', createSupplementsRouter(db));
app.use('/api/ai', createAiRouter());

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Nutrition tracker API running on http://localhost:${PORT}`);
});
