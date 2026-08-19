const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AI_MONTHLY_CAP = Number(process.env.AI_MONTHLY_CAP || 200);

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

function ensureAuthTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      apple_sub TEXT UNIQUE,
      display_name TEXT,
      is_coach INTEGER NOT NULL DEFAULT 0,
      onboarding_completed_at TEXT,
      invite_code TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS email_otps (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id INTEGER NOT NULL,
      ym TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, ym)
    );
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS org_memberships (
      org_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'coach',
      PRIMARY KEY (org_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS coach_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_user_id INTEGER NOT NULL,
      client_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      scope_nutrition INTEGER NOT NULL DEFAULT 1,
      scope_training INTEGER NOT NULL DEFAULT 1,
      scope_weight INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (coach_user_id, client_user_id)
    );
  `);
}

/** One-shot: create owner user and reassign legacy user_id=0 rows to them. */
function migrateLegacyUserZero(db) {
  ensureAuthTables(db);

  let owner = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (!owner) {
    const invite = randomInviteCode();
    const r = db
      .prepare(
        `INSERT INTO users (email, display_name, is_coach, onboarding_completed_at, invite_code)
         VALUES (?, ?, 0, ?, ?)`
      )
      .run('owner@local.flops', 'Owner', new Date().toISOString(), invite);
    owner = { id: Number(r.lastInsertRowid) };
  }
  const ownerId = owner.id;

  // Recipes / log_entries historically had no user_id — add and backfill.
  const recipeCols = db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name);
  if (recipeCols.length && !recipeCols.includes('user_id')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
  }
  const logCols = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
  if (logCols.length && !logCols.includes('user_id')) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
  }

  const profileCols = db.prepare('PRAGMA table_info(user_profile)').all().map(c => c.name);
  if (profileCols.length && !profileCols.includes('onboarding_completed_at')) {
    // mirrored on users; keep profile lean
  }

  const tablesWithUserId = [
    'label_ingredients',
    'day_goals',
    'day_goal_versions',
    'user_profile',
    'body_weights',
    'training_schedule',
    'training_overrides',
    'training_saved_recipes',
    'training_feedback',
    'daily_training_context',
    'workout_presets',
    'workout_preset_exercises',
    'workout_day_selections',
    'exercise_logs',
    'supplements',
    'supplement_log',
    'recipes',
    'log_entries',
  ];
  for (const table of tablesWithUserId) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes('user_id')) continue;
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 0 OR user_id IS NULL`).run(ownerId);
    } catch {
      /* table may not exist in older fixtures */
    }
  }

  // Ensure owner has a profile row and invite code.
  const u = db.prepare('SELECT invite_code FROM users WHERE id = ?').get(ownerId);
  if (u && !u.invite_code) {
    db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(randomInviteCode(), ownerId);
  }
  const prof = db.prepare('SELECT user_id FROM user_profile WHERE user_id = ?').get(ownerId);
  if (!prof) {
    db.prepare('INSERT INTO user_profile (user_id) VALUES (?)').run(ownerId);
  }

  return ownerId;
}

function createSession(db, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires_at: expires };
}

function userFromToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

function storeOtp(db, email, code) {
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO email_otps (email, code, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`
  ).run(email, code, expires);
}

function verifyOtp(db, email, code) {
  const row = db.prepare('SELECT code, expires_at FROM email_otps WHERE email = ?').get(email);
  if (!row) return false;
  if (row.expires_at < new Date().toISOString()) return false;
  if (String(row.code) !== String(code)) return false;
  db.prepare('DELETE FROM email_otps WHERE email = ?').run(email);
  return true;
}

function findOrCreateEmailUser(db, email, { displayName } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (!user) {
    // First real sign-in claims the legacy owner row that holds migrated local data.
    const legacy = db.prepare('SELECT * FROM users WHERE email = ?').get('owner@local.flops');
    if (legacy && normalized !== 'owner@local.flops') {
      db.prepare('UPDATE users SET email = ?, display_name = COALESCE(?, display_name) WHERE id = ?').run(
        normalized,
        displayName || normalized.split('@')[0],
        legacy.id
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(legacy.id);
    } else {
      const invite = randomInviteCode();
      const r = db
        .prepare(`INSERT INTO users (email, display_name, invite_code) VALUES (?, ?, ?)`)
        .run(normalized, displayName || normalized.split('@')[0], invite);
      const id = Number(r.lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO user_profile (user_id) VALUES (?)').run(id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
  }
  return user;
}

function findOrCreateAppleUser(db, { apple_sub, email, display_name }) {
  let user = db.prepare('SELECT * FROM users WHERE apple_sub = ?').get(apple_sub);
  if (user) return user;
  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
    if (user) {
      db.prepare('UPDATE users SET apple_sub = ? WHERE id = ?').run(apple_sub, user.id);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
  }
  const invite = randomInviteCode();
  const r = db
    .prepare(
      `INSERT INTO users (email, apple_sub, display_name, invite_code) VALUES (?, ?, ?, ?)`
    )
    .run(email ? String(email).toLowerCase() : null, apple_sub, display_name || 'Apple user', invite);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO user_profile (user_id) VALUES (?)').run(id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_coach: row.is_coach ? 1 : 0,
    onboarding_completed_at: row.onboarding_completed_at || null,
    invite_code: row.invite_code || null,
  };
}

function checkAiQuota(db, userId) {
  const ym = new Date().toISOString().slice(0, 7);
  const row = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND ym = ?').get(userId, ym);
  const count = row?.count || 0;
  if (count >= AI_MONTHLY_CAP) {
    const err = new Error(`AI monthly cap (${AI_MONTHLY_CAP}) reached for this account.`);
    err.status = 429;
    err.code = 'AI_CAP';
    throw err;
  }
}

function bumpAiUsage(db, userId) {
  const ym = new Date().toISOString().slice(0, 7);
  db.prepare(
    `INSERT INTO ai_usage (user_id, ym, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, ym) DO UPDATE SET count = count + 1`
  ).run(userId, ym);
}

module.exports = {
  ensureAuthTables,
  migrateLegacyUserZero,
  createSession,
  userFromToken,
  storeOtp,
  verifyOtp,
  findOrCreateEmailUser,
  findOrCreateAppleUser,
  publicUser,
  randomOtp,
  randomInviteCode,
  checkAiQuota,
  bumpAiUsage,
  AI_MONTHLY_CAP,
  SESSION_TTL_MS,
};
