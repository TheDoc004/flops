const Database = require('better-sqlite3');

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      serving_size TEXT NOT NULL,
      calories     REAL NOT NULL,
      protein_g    REAL NOT NULL,
      carbs_g      REAL NOT NULL,
      fat_g        REAL NOT NULL,
      fiber_g      REAL
    );
    CREATE TABLE IF NOT EXISTS log_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id  INTEGER NOT NULL,
      date       TEXT NOT NULL,
      servings   REAL NOT NULL,
      notes      TEXT,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );
  `);
  return db;
}

module.exports = { createDb };
