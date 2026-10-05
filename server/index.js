const path = require('path');
// Load a local server/.env if present (real environment vars still win on Render etc.).
// process.loadEnvFile is built into Node 20.12+/21.7+ — no dotenv dependency needed.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* no .env file — rely on the process environment */
}

// Server-local dates ("today" for MCP writes/reads) follow the owner's calendar,
// not the host's UTC clock. Render's dashboard env can still override it.
if (!process.env.TZ) process.env.TZ = 'America/Los_Angeles';

if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV == null) {
  process.env.AUTH_DEV = '1';
}

const { createApp } = require('./createApp');
const { createDb } = require('./db');

const db = createDb(process.env.DB_PATH || './nutrition.db');
const app = createApp(db);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Nutrition tracker API running on http://localhost:${PORT}`);
});
