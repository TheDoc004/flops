# Nutrition Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal web app for logging meals with calorie/macro data and tracking nutrition over time with daily and historical views.

**Architecture:** React (Vite) SPA on port 5173 proxied to a Node/Express REST API on port 3001, backed by SQLite. Routes accept a `db` instance via factory functions, so tests can inject in-memory SQLite without mocking.

**Tech Stack:** React 18, React Router v6, Vite 5, Node.js, Express 4, better-sqlite3, recharts, Jest + Supertest (server), Vitest + React Testing Library (client)

---

## File Map

**Server (`server/`)**
- `server/package.json` — deps + Jest test script
- `server/db.js` — `createDb(path)` creates tables, returns db instance
- `server/routes/recipes.js` — `createRecipesRouter(db)` — CRUD for recipes
- `server/routes/log.js` — `createLogRouter(db)` — CRUD for log entries
- `server/index.js` — Express entry point
- `server/__tests__/db.test.js` — schema tests
- `server/__tests__/recipes.test.js` — Supertest tests for recipes routes
- `server/__tests__/log.test.js` — Supertest tests for log routes

**Client (`client/`)**
- `client/package.json` — deps
- `client/vite.config.js` — Vite + proxy + Vitest config
- `client/index.html` — HTML shell
- `client/src/main.jsx` — React entry point
- `client/src/App.jsx` — Router + layout
- `client/src/index.css` — Global styles
- `client/src/test-setup.js` — jest-dom setup
- `client/src/utils/macros.js` — `computeEntryMacros`, `sumMacros`, `groupByDate`
- `client/src/utils/macros.test.js` — Vitest tests for macro utils
- `client/src/hooks/useTargets.js` — localStorage hook for daily macro targets
- `client/src/hooks/useTargets.test.js` — Vitest tests for hook
- `client/src/api/recipes.js` — fetch wrappers for /api/recipes
- `client/src/api/log.js` — fetch wrappers for /api/log
- `client/src/components/Navbar.jsx` + `Navbar.module.css`
- `client/src/components/MacroTotals.jsx` — macro summary bars
- `client/src/components/LogEntryRow.jsx` — single log entry row
- `client/src/components/LogMealModal.jsx` — modal to log a meal
- `client/src/components/RecipeForm.jsx` — add/edit recipe form
- `client/src/components/RecipeRow.jsx` — recipe row with edit/delete
- `client/src/components/RangeSelector.jsx` — 7d/30d/90d picker
- `client/src/pages/Dashboard.jsx` — today's log + macro totals + targets editor
- `client/src/pages/Recipes.jsx` — recipe library
- `client/src/pages/History.jsx` — charts + date picker

---

### Task 1: Server project setup

**Files:**
- Create: `server/package.json`
- Create: `server/db.js`
- Create: `server/__tests__/db.test.js`

- [ ] **Step 1: Create server directory structure**

Run from `nutrition-tracker/`:
```bash
mkdir -p server/routes server/__tests__
```

- [ ] **Step 2: Create server/package.json**

Create `server/package.json`:
```json
{
  "name": "nutrition-tracker-server",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  }
}
```

- [ ] **Step 3: Install server dependencies**

Run:
```bash
cd server && npm install
```
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Write failing tests for createDb**

Create `server/__tests__/db.test.js`:
```js
const { createDb } = require('../db');

describe('createDb', () => {
  it('creates both tables', () => {
    const db = createDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('recipes');
    expect(names).toContain('log_entries');
  });

  it('recipes table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    ]));
  });

  it('log_entries table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'recipe_id', 'date', 'servings', 'notes',
    ]));
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run:
```bash
cd server && npm test -- __tests__/db.test.js
```
Expected: FAIL with "Cannot find module '../db'"

- [ ] **Step 6: Implement db.js**

Create `server/db.js`:
```js
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run:
```bash
cd server && npm test -- __tests__/db.test.js
```
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add server/ && git commit -m "feat: server setup with SQLite db factory"
```

---

### Task 2: Recipes API routes (TDD)

**Files:**
- Create: `server/routes/recipes.js`
- Create: `server/__tests__/recipes.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/recipes.test.js`:
```js
const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createRecipesRouter } = require('../routes/recipes');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/recipes', createRecipesRouter(db));
  return app;
}

const sample = {
  name: 'Oatmeal', serving_size: '1 cup',
  calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
};

describe('GET /api/recipes', () => {
  it('returns empty array when no recipes exist', async () => {
    const res = await request(buildApp()).get('/api/recipes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all recipes sorted by name', async () => {
    const app = buildApp();
    await request(app).post('/api/recipes').send({ ...sample, name: 'Zucchini' });
    await request(app).post('/api/recipes').send({ ...sample, name: 'Apple' });
    const res = await request(app).get('/api/recipes');
    expect(res.body[0].name).toBe('Apple');
    expect(res.body[1].name).toBe('Zucchini');
  });
});

describe('POST /api/recipes', () => {
  it('creates a recipe and returns it with an id', async () => {
    const res = await request(buildApp()).post('/api/recipes').send(sample);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Oatmeal');
    expect(res.body.calories).toBe(150);
  });

  it('stores fiber_g as null when not provided', async () => {
    const res = await request(buildApp()).post('/api/recipes').send(sample);
    expect(res.body.fiber_g).toBeNull();
  });

  it('stores fiber_g when provided', async () => {
    const res = await request(buildApp()).post('/api/recipes').send({ ...sample, fiber_g: 4 });
    expect(res.body.fiber_g).toBe(4);
  });

  it('returns 400 when name is missing', async () => {
    const { name, ...body } = sample;
    const res = await request(buildApp()).post('/api/recipes').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when calories is missing', async () => {
    const { calories, ...body } = sample;
    const res = await request(buildApp()).post('/api/recipes').send(body);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/recipes/:id', () => {
  it('updates an existing recipe', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).put(`/api/recipes/${created.id}`).send({
      ...sample, name: 'Steel Cut Oats', calories: 170,
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Steel Cut Oats');
    expect(res.body.calories).toBe(170);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).put('/api/recipes/999').send(sample);
    expect(res.status).toBe(404);
  });

  it('returns 400 when required fields are missing', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).put(`/api/recipes/${created.id}`).send({ name: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/recipes/:id', () => {
  it('deletes a recipe and returns 204', async () => {
    const app = buildApp();
    const { body: created } = await request(app).post('/api/recipes').send(sample);
    const res = await request(app).delete(`/api/recipes/${created.id}`);
    expect(res.status).toBe(204);
    const list = await request(app).get('/api/recipes');
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).delete('/api/recipes/999');
    expect(res.status).toBe(404);
  });

  it('returns 409 when recipe has log entries', async () => {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/recipes', createRecipesRouter(db));
    const { body: recipe } = await request(app).post('/api/recipes').send(sample);
    db.prepare('INSERT INTO log_entries (recipe_id, date, servings) VALUES (?, ?, ?)').run(recipe.id, '2026-04-09', 1);
    const res = await request(app).delete(`/api/recipes/${recipe.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/log/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd server && npm test -- __tests__/recipes.test.js
```
Expected: FAIL with "Cannot find module '../routes/recipes'"

- [ ] **Step 3: Implement recipes routes**

Create `server/routes/recipes.js`:
```js
const express = require('express');

function createRecipesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const recipes = db.prepare('SELECT * FROM recipes ORDER BY name').all();
    res.json(recipes);
  });

  router.post('/', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const result = db.prepare(
      'INSERT INTO recipes (name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name, serving_size, Number(calories), Number(protein_g), Number(carbs_g), Number(fat_g), fiber_g != null ? Number(fiber_g) : null);
    res.status(201).json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const { name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g } = req.body;
    if (!name || !serving_size || calories == null || protein_g == null || carbs_g == null || fat_g == null) {
      return res.status(400).json({ error: 'Missing required fields: name, serving_size, calories, protein_g, carbs_g, fat_g' });
    }
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    db.prepare(
      'UPDATE recipes SET name=?, serving_size=?, calories=?, protein_g=?, carbs_g=?, fat_g=?, fiber_g=? WHERE id=?'
    ).run(name, serving_size, Number(calories), Number(protein_g), Number(carbs_g), Number(fat_g), fiber_g != null ? Number(fiber_g) : null, req.params.id);
    res.json(db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    const hasLogs = db.prepare('SELECT id FROM log_entries WHERE recipe_id = ? LIMIT 1').get(req.params.id);
    if (hasLogs) {
      return res.status(409).json({ error: 'This recipe has logged meals. Delete those log entries first before removing the recipe.' });
    }
    db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });

  return router;
}

module.exports = { createRecipesRouter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd server && npm test -- __tests__/recipes.test.js
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/routes/recipes.js server/__tests__/recipes.test.js && git commit -m "feat: recipes CRUD API with tests"
```

---

### Task 3: Log API routes (TDD)

**Files:**
- Create: `server/routes/log.js`
- Create: `server/__tests__/log.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/log.test.js`:
```js
const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createRecipesRouter } = require('../routes/recipes');
const { createLogRouter } = require('../routes/log');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/log', createLogRouter(db));
  return app;
}

async function seedRecipe(app) {
  const res = await request(app).post('/api/recipes').send({
    name: 'Oatmeal', serving_size: '1 cup', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
  });
  return res.body;
}

describe('GET /api/log?date=', () => {
  it('returns empty array for a date with no entries', async () => {
    const res = await request(buildApp()).get('/api/log?date=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns entries with joined recipe fields', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1.5 });
    const res = await request(app).get('/api/log?date=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const e = res.body[0];
    expect(e.recipe_name).toBe('Oatmeal');
    expect(e.servings).toBe(1.5);
    expect(e.recipe_calories).toBe(150);
    expect(e.recipe_protein_g).toBe(5);
    expect(e.recipe_carbs_g).toBe(27);
    expect(e.recipe_fat_g).toBe(3);
  });

  it('does not return entries for a different date', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-08', servings: 1 });
    const res = await request(app).get('/api/log?date=2026-04-09');
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/log?start=&end=', () => {
  it('returns all entries in the date range', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-07', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 2 });
    const res = await request(app).get('/api/log?start=2026-04-07&end=2026-04-09');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('excludes entries outside the range', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-06', servings: 1 });
    await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).get('/api/log?start=2026-04-07&end=2026-04-09');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe('2026-04-09');
  });
});

describe('GET /api/log (no params)', () => {
  it('returns 400', async () => {
    const res = await request(buildApp()).get('/api/log');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/log', () => {
  it('creates an entry and returns it with joined recipe data', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const res = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 2 });
    expect(res.status).toBe(201);
    expect(res.body.recipe_name).toBe('Oatmeal');
    expect(res.body.servings).toBe(2);
    expect(res.body.id).toBeDefined();
  });

  it('stores optional notes', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const res = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1, notes: 'post-workout' });
    expect(res.body.notes).toBe('post-workout');
  });

  it('returns 400 when recipe_id is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ date: '2026-04-09', servings: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 1, servings: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when servings is missing', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 1, date: '2026-04-09' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when recipe does not exist', async () => {
    const res = await request(buildApp()).post('/api/log').send({ recipe_id: 999, date: '2026-04-09', servings: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/log/:id', () => {
  it('deletes an entry and returns 204', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const { body: entry } = await request(app).post('/api/log').send({ recipe_id: recipe.id, date: '2026-04-09', servings: 1 });
    const res = await request(app).delete(`/api/log/${entry.id}`);
    expect(res.status).toBe(204);
    const list = await request(app).get('/api/log?date=2026-04-09');
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(buildApp()).delete('/api/log/999');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd server && npm test -- __tests__/log.test.js
```
Expected: FAIL with "Cannot find module '../routes/log'"

- [ ] **Step 3: Implement log routes**

Create `server/routes/log.js`:
```js
const express = require('express');

const ENTRY_JOIN = `
  SELECT le.id, le.recipe_id, le.date, le.servings, le.notes,
         r.name AS recipe_name, r.serving_size,
         r.calories AS recipe_calories, r.protein_g AS recipe_protein_g,
         r.carbs_g AS recipe_carbs_g, r.fat_g AS recipe_fat_g,
         r.fiber_g AS recipe_fiber_g
  FROM log_entries le
  JOIN recipes r ON le.recipe_id = r.id
`;

function createLogRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { date, start, end } = req.query;
    if (date) {
      return res.json(db.prepare(`${ENTRY_JOIN} WHERE le.date = ? ORDER BY le.id`).all(date));
    }
    if (start && end) {
      return res.json(db.prepare(`${ENTRY_JOIN} WHERE le.date >= ? AND le.date <= ? ORDER BY le.date, le.id`).all(start, end));
    }
    res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?start=YYYY-MM-DD&end=YYYY-MM-DD' });
  });

  router.post('/', (req, res) => {
    const { recipe_id, date, servings, notes } = req.body;
    if (!recipe_id || !date || servings == null) {
      return res.status(400).json({ error: 'Missing required fields: recipe_id, date, servings' });
    }
    if (!db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe_id)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    const result = db.prepare(
      'INSERT INTO log_entries (recipe_id, date, servings, notes) VALUES (?, ?, ?, ?)'
    ).run(recipe_id, date, Number(servings), notes ?? null);
    res.status(201).json(db.prepare(`${ENTRY_JOIN} WHERE le.id = ?`).get(result.lastInsertRowid));
  });

  router.delete('/:id', (req, res) => {
    if (!db.prepare('SELECT id FROM log_entries WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Log entry not found' });
    }
    db.prepare('DELETE FROM log_entries WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });

  return router;
}

module.exports = { createLogRouter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd server && npm test -- __tests__/log.test.js
```
Expected: PASS (all tests)

- [ ] **Step 5: Run the full server test suite**

Run:
```bash
cd server && npm test
```
Expected: PASS (all tests across all three test files)

- [ ] **Step 6: Commit**

```bash
git add server/routes/log.js server/__tests__/log.test.js && git commit -m "feat: log entries CRUD API with tests"
```

---

### Task 4: Express entry point

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Create index.js**

Create `server/index.js`:
```js
const express = require('express');
const cors = require('cors');
const { createDb } = require('./db');
const { createRecipesRouter } = require('./routes/recipes');
const { createLogRouter } = require('./routes/log');

const db = createDb(process.env.DB_PATH || './nutrition.db');
const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/recipes', createRecipesRouter(db));
app.use('/api/log', createLogRouter(db));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Nutrition tracker API running on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Smoke test the server**

Run in one terminal:
```bash
cd server && node index.js
```
Expected output: `Nutrition tracker API running on http://localhost:3001`

In another terminal:
```bash
curl -s http://localhost:3001/api/recipes
```
Expected: `[]`

Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add server/index.js && git commit -m "feat: Express entry point"
```

---

### Task 5: Client scaffold

**Files:**
- Create: `client/` (Vite React project)
- Modify: `client/vite.config.js`
- Create: `client/src/test-setup.js`
- Create: `client/src/index.css`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx`
- Create: `client/src/components/Navbar.jsx`
- Create: `client/src/components/Navbar.module.css`
- Create: `client/src/pages/Dashboard.jsx` (placeholder)
- Create: `client/src/pages/Recipes.jsx` (placeholder)
- Create: `client/src/pages/History.jsx` (placeholder)

- [ ] **Step 1: Scaffold Vite React project**

Run from `nutrition-tracker/`:
```bash
npm create vite@latest client -- --template react
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd client && npm install
npm install react-router-dom recharts
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 3: Replace vite.config.js**

Replace `client/vite.config.js` with:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    globals: true,
  },
});
```

Add `"test": "vitest run"` and `"test:watch": "vitest"` to the `scripts` section of `client/package.json`.

- [ ] **Step 4: Create test-setup.js**

Create `client/src/test-setup.js`:
```js
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Replace index.css**

Replace `client/src/index.css` with:
```css
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
}

a { color: inherit; text-decoration: none; }

button {
  cursor: pointer;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary { background: #2563eb; color: white; }
.btn-primary:hover { background: #1d4ed8; }
.btn-danger { background: #dc2626; color: white; }
.btn-danger:hover { background: #b91c1c; }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; }

input, select, textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  width: 100%;
}

input:focus, select:focus, textarea:focus {
  outline: 2px solid #2563eb;
  border-color: transparent;
}

label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
  color: #374151;
}

.card {
  background: white;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.error { color: #dc2626; font-size: 13px; margin-top: 4px; }
.empty-state { text-align: center; color: #9ca3af; padding: 40px 0; }

dialog {
  border: none;
  border-radius: 12px;
  padding: 24px;
  width: min(480px, 90vw);
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}
dialog::backdrop { background: rgba(0,0,0,0.4); }
```

- [ ] **Step 6: Create Navbar component**

Create `client/src/components/Navbar.module.css`:
```css
.nav {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 0 24px;
  height: 56px;
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand { font-size: 18px; font-weight: 700; color: #2563eb; }
.links { display: flex; gap: 8px; }
.links a { padding: 6px 12px; border-radius: 6px; color: #6b7280; font-weight: 500; }
.links a:hover { background: #f3f4f6; color: #1a1a1a; }
.active { background: #eff6ff !important; color: #2563eb !important; }
```

Create `client/src/components/Navbar.jsx`:
```jsx
import { NavLink } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
  return (
    <nav className={styles.nav}>
      <span className={styles.brand}>NutriLog</span>
      <div className={styles.links}>
        <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ''}>Dashboard</NavLink>
        <NavLink to="/recipes" className={({ isActive }) => isActive ? styles.active : ''}>Recipes</NavLink>
        <NavLink to="/history" className={({ isActive }) => isActive ? styles.active : ''}>History</NavLink>
      </div>
    </nav>
  );
}
```

- [ ] **Step 7: Create placeholder pages**

Create `client/src/pages/Dashboard.jsx`:
```jsx
export default function Dashboard() { return <div>Dashboard</div>; }
```

Create `client/src/pages/Recipes.jsx`:
```jsx
export default function Recipes() { return <div>Recipes</div>; }
```

Create `client/src/pages/History.jsx`:
```jsx
export default function History() { return <div>History</div>; }
```

- [ ] **Step 8: Create App.jsx and update main.jsx**

Replace `client/src/App.jsx` with:
```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Recipes from './pages/Recipes';
import History from './pages/History';

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

Replace `client/src/main.jsx` with:
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 9: Verify the client dev server starts**

Run:
```bash
cd client && npm run dev
```
Expected: Vite server on http://localhost:5173. Open in browser — see "NutriLog" navbar with Dashboard/Recipes/History links and placeholder page text. Stop with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add client/ && git commit -m "feat: client scaffold with Vite, routing, Navbar"
```

---

### Task 6: Macro utility functions (TDD)

**Files:**
- Create: `client/src/utils/macros.js`
- Create: `client/src/utils/macros.test.js`

- [ ] **Step 1: Write failing tests**

Create `client/src/utils/macros.test.js`:
```js
import { computeEntryMacros, sumMacros, groupByDate } from './macros';

const makeEntry = (overrides = {}) => ({
  recipe_calories: 200,
  recipe_protein_g: 10,
  recipe_carbs_g: 30,
  recipe_fat_g: 5,
  servings: 1,
  date: '2026-04-09',
  ...overrides,
});

describe('computeEntryMacros', () => {
  it('multiplies all macros by servings', () => {
    const result = computeEntryMacros(makeEntry({ servings: 2 }));
    expect(result.calories).toBe(400);
    expect(result.protein_g).toBe(20);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(10);
  });

  it('handles fractional servings', () => {
    const result = computeEntryMacros(makeEntry({ servings: 0.5 }));
    expect(result.calories).toBe(100);
    expect(result.protein_g).toBe(5);
  });
});

describe('sumMacros', () => {
  it('sums macros across entries', () => {
    const result = sumMacros([makeEntry({ servings: 1 }), makeEntry({ servings: 1 })]);
    expect(result.calories).toBe(400);
    expect(result.protein_g).toBe(20);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(10);
  });

  it('returns zero totals for empty array', () => {
    expect(sumMacros([])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});

describe('groupByDate', () => {
  it('aggregates entries by date', () => {
    const entries = [
      makeEntry({ date: '2026-04-09', servings: 1 }),
      makeEntry({ date: '2026-04-09', servings: 1 }),
      makeEntry({ date: '2026-04-08', servings: 1 }),
    ];
    const result = groupByDate(entries);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.date === '2026-04-09').calories).toBe(400);
  });

  it('returns results sorted by date ascending', () => {
    const entries = [
      makeEntry({ date: '2026-04-10' }),
      makeEntry({ date: '2026-04-08' }),
      makeEntry({ date: '2026-04-09' }),
    ];
    const result = groupByDate(entries);
    expect(result[0].date).toBe('2026-04-08');
    expect(result[2].date).toBe('2026-04-10');
  });

  it('returns empty array for no entries', () => {
    expect(groupByDate([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd client && npm test
```
Expected: FAIL with "Cannot find module './macros'"

- [ ] **Step 3: Implement macros.js**

Create `client/src/utils/macros.js`:
```js
export function computeEntryMacros(entry) {
  return {
    calories: entry.recipe_calories * entry.servings,
    protein_g: entry.recipe_protein_g * entry.servings,
    carbs_g: entry.recipe_carbs_g * entry.servings,
    fat_g: entry.recipe_fat_g * entry.servings,
  };
}

export function sumMacros(entries) {
  return entries.reduce(
    (acc, entry) => {
      const m = computeEntryMacros(entry);
      acc.calories += m.calories;
      acc.protein_g += m.protein_g;
      acc.carbs_g += m.carbs_g;
      acc.fat_g += m.fat_g;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

export function groupByDate(entries) {
  const map = {};
  for (const entry of entries) {
    if (!map[entry.date]) {
      map[entry.date] = { date: entry.date, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    }
    const m = computeEntryMacros(entry);
    map[entry.date].calories += m.calories;
    map[entry.date].protein_g += m.protein_g;
    map[entry.date].carbs_g += m.carbs_g;
    map[entry.date].fat_g += m.fat_g;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd client && npm test
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/ && git commit -m "feat: macro computation utilities with tests"
```

---

### Task 7: API client modules

**Files:**
- Create: `client/src/api/recipes.js`
- Create: `client/src/api/log.js`

- [ ] **Step 1: Create recipes API client**

Create `client/src/api/recipes.js`:
```js
export async function fetchRecipes() {
  const res = await fetch('/api/recipes');
  if (!res.ok) throw new Error('Failed to fetch recipes');
  return res.json();
}

export async function createRecipe(data) {
  const res = await fetch('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to create recipe'); }
  return res.json();
}

export async function updateRecipe(id, data) {
  const res = await fetch(`/api/recipes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to update recipe'); }
  return res.json();
}

export async function deleteRecipe(id) {
  const res = await fetch(`/api/recipes/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to delete recipe'); }
}
```

- [ ] **Step 2: Create log API client**

Create `client/src/api/log.js`:
```js
export async function fetchLogForDate(date) {
  const res = await fetch(`/api/log?date=${date}`);
  if (!res.ok) throw new Error('Failed to fetch log');
  return res.json();
}

export async function fetchLogRange(start, end) {
  const res = await fetch(`/api/log?start=${start}&end=${end}`);
  if (!res.ok) throw new Error('Failed to fetch log range');
  return res.json();
}

export async function createLogEntry(data) {
  const res = await fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to log meal'); }
  return res.json();
}

export async function deleteLogEntry(id) {
  const res = await fetch(`/api/log/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete log entry');
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api/ && git commit -m "feat: API client modules for recipes and log"
```

---

### Task 8: Recipe Library page

**Files:**
- Create: `client/src/components/RecipeForm.jsx`
- Create: `client/src/components/RecipeRow.jsx`
- Modify: `client/src/pages/Recipes.jsx`

- [ ] **Step 1: Create RecipeForm component**

Create `client/src/components/RecipeForm.jsx`:
```jsx
import { useState } from 'react';

const EMPTY = { name: '', serving_size: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' };

export default function RecipeForm({ initial = EMPTY, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await onSubmit({
        name: form.name.trim(),
        serving_size: form.serving_size.trim(),
        calories: Number(form.calories),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
        fiber_g: form.fiber_g !== '' ? Number(form.fiber_g) : undefined,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label>Name</label>
        <input value={form.name} onChange={set('name')} required placeholder="e.g. Chicken Rice Bowl" />
      </div>
      <div>
        <label>Serving size</label>
        <input value={form.serving_size} onChange={set('serving_size')} required placeholder="e.g. 1 cup, 200g" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label>Calories</label><input type="number" min="0" step="0.1" value={form.calories} onChange={set('calories')} required /></div>
        <div><label>Protein (g)</label><input type="number" min="0" step="0.1" value={form.protein_g} onChange={set('protein_g')} required /></div>
        <div><label>Carbs (g)</label><input type="number" min="0" step="0.1" value={form.carbs_g} onChange={set('carbs_g')} required /></div>
        <div><label>Fat (g)</label><input type="number" min="0" step="0.1" value={form.fat_g} onChange={set('fat_g')} required /></div>
        <div><label>Fiber (g, optional)</label><input type="number" min="0" step="0.1" value={form.fiber_g} onChange={set('fiber_g')} /></div>
      </div>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create RecipeRow component**

Create `client/src/components/RecipeRow.jsx`:
```jsx
export default function RecipeRow({ recipe, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <strong>{recipe.name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>per {recipe.serving_size}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#374151' }}>
        <span><strong>{recipe.calories}</strong> cal</span>
        <span>P: {recipe.protein_g}g</span>
        <span>C: {recipe.carbs_g}g</span>
        <span>F: {recipe.fat_g}g</span>
        {recipe.fiber_g != null && <span>Fiber: {recipe.fiber_g}g</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" onClick={() => onEdit(recipe)}>Edit</button>
        <button className="btn-danger" onClick={() => onDelete(recipe)}>Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement Recipes page**

Replace `client/src/pages/Recipes.jsx` with:
```jsx
import { useEffect, useState } from 'react';
import RecipeForm from '../components/RecipeForm';
import RecipeRow from '../components/RecipeRow';
import { fetchRecipes, createRecipe, updateRecipe, deleteRecipe } from '../api/recipes';

export default function Recipes() {
  const [recipes, setRecipes] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try { setRecipes(await fetchRecipes()); }
    catch (e) { setError(e.message); }
  }

  async function handleAdd(data) {
    await createRecipe(data);
    setShowAdd(false);
    load();
  }

  async function handleEdit(data) {
    await updateRecipe(editing.id, data);
    setEditing(null);
    load();
  }

  async function handleDelete(recipe) {
    try { await deleteRecipe(recipe.id); load(); }
    catch (e) { setError(e.message); }
  }

  const filtered = recipes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Recipe Library</h1>
        <button className="btn-primary" onClick={() => { setShowAdd(true); setEditing(null); }}>+ Add Recipe</button>
      </div>

      {error && <p className="error">{error}</p>}

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>New Recipe</h3>
          <RecipeForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Add Recipe" />
        </div>
      )}

      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Edit Recipe</h3>
          <RecipeForm
            initial={{ ...editing, fiber_g: editing.fiber_g ?? '' }}
            onSubmit={handleEdit}
            onCancel={() => setEditing(null)}
            submitLabel="Save Changes"
          />
        </div>
      )}

      <div className="card">
        <input placeholder="Search recipes..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
        {filtered.length === 0
          ? <p className="empty-state">{recipes.length === 0 ? 'No recipes yet. Add your first recipe!' : 'No recipes match your search.'}</p>
          : filtered.map(recipe => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                onEdit={r => { setEditing(r); setShowAdd(false); }}
                onDelete={handleDelete}
              />
            ))
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the Recipes page works end-to-end**

Start both servers in separate terminals:
```bash
# Terminal 1
cd server && node index.js

# Terminal 2
cd client && npm run dev
```

Open http://localhost:5173/recipes and verify:
- "Recipe Library" heading and "+ Add Recipe" button visible
- Clicking "+ Add Recipe" shows the form inline
- Add a recipe (name=Oatmeal, serving=1 cup, cal=150, p=5, c=27, f=3) — it appears in the list
- Edit button pre-fills the edit form
- Delete removes the recipe from the list
- If a recipe has log entries, delete shows the error message from the 409 response

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RecipeForm.jsx client/src/components/RecipeRow.jsx client/src/pages/Recipes.jsx
git commit -m "feat: Recipe Library page with add/edit/delete"
```

---

### Task 9: Dashboard page

**Files:**
- Create: `client/src/hooks/useTargets.js`
- Create: `client/src/hooks/useTargets.test.js`
- Create: `client/src/components/MacroTotals.jsx`
- Create: `client/src/components/LogEntryRow.jsx`
- Create: `client/src/components/LogMealModal.jsx`
- Modify: `client/src/pages/Dashboard.jsx`

- [ ] **Step 1: Write failing tests for useTargets**

Create `client/src/hooks/useTargets.test.js`:
```js
import { renderHook, act } from '@testing-library/react';
import { useTargets } from './useTargets';

beforeEach(() => localStorage.clear());

describe('useTargets', () => {
  it('returns null targets when localStorage is empty', () => {
    const { result } = renderHook(() => useTargets());
    expect(result.current.targets).toEqual({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
  });

  it('setTarget updates a single macro target', () => {
    const { result } = renderHook(() => useTargets());
    act(() => result.current.setTarget('calories', 2000));
    expect(result.current.targets.calories).toBe(2000);
  });

  it('persists targets to localStorage', () => {
    const { result } = renderHook(() => useTargets());
    act(() => result.current.setTarget('protein_g', 150));
    expect(JSON.parse(localStorage.getItem('nutriTargets')).protein_g).toBe(150);
  });

  it('loads persisted targets on mount', () => {
    localStorage.setItem('nutriTargets', JSON.stringify({ calories: 1800, protein_g: 120, carbs_g: null, fat_g: null }));
    const { result } = renderHook(() => useTargets());
    expect(result.current.targets.calories).toBe(1800);
    expect(result.current.targets.protein_g).toBe(120);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd client && npm test
```
Expected: FAIL with "Cannot find module './useTargets'"

- [ ] **Step 3: Implement useTargets hook**

Create `client/src/hooks/useTargets.js`:
```js
import { useState } from 'react';

const KEY = 'nutriTargets';
const DEFAULTS = { calories: null, protein_g: null, carbs_g: null, fat_g: null };

export function useTargets() {
  const [targets, setTargets] = useState(() => {
    try {
      const stored = localStorage.getItem(KEY);
      return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  });

  function setTarget(macro, value) {
    setTargets(prev => {
      const next = { ...prev, [macro]: value };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }

  return { targets, setTarget };
}
```

- [ ] **Step 4: Run all client tests to verify they pass**

Run:
```bash
cd client && npm test
```
Expected: PASS (macros tests + useTargets tests)

- [ ] **Step 5: Create MacroTotals component**

Create `client/src/components/MacroTotals.jsx`:
```jsx
function MacroBar({ label, value, target, color }) {
  const pct = target ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#6b7280' }}>
          {Math.round(value)}{target ? ` / ${target}` : ''}
        </span>
      </div>
      {target && (
        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  );
}

export default function MacroTotals({ totals, targets }) {
  return (
    <div className="card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
      <MacroBar label="Calories" value={totals.calories} target={targets.calories} color="#f59e0b" />
      <MacroBar label="Protein"  value={totals.protein_g} target={targets.protein_g} color="#3b82f6" />
      <MacroBar label="Carbs"    value={totals.carbs_g}   target={targets.carbs_g}   color="#10b981" />
      <MacroBar label="Fat"      value={totals.fat_g}     target={targets.fat_g}     color="#ef4444" />
    </div>
  );
}
```

- [ ] **Step 6: Create LogEntryRow component**

Create `client/src/components/LogEntryRow.jsx`:
```jsx
import { computeEntryMacros } from '../utils/macros';

export default function LogEntryRow({ entry, onDelete }) {
  const m = computeEntryMacros(entry);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <strong>{entry.recipe_name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>{entry.servings}x {entry.serving_size}</span>
        {entry.notes && <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>· {entry.notes}</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
        <span><strong>{Math.round(m.calories)}</strong> cal</span>
        <span>P: {m.protein_g.toFixed(1)}g</span>
        <span>C: {m.carbs_g.toFixed(1)}g</span>
        <span>F: {m.fat_g.toFixed(1)}g</span>
      </div>
      {onDelete && (
        <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onDelete(entry)}>✕</button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create LogMealModal component**

Create `client/src/components/LogMealModal.jsx`:
```jsx
import { useEffect, useRef, useState } from 'react';
import { fetchRecipes } from '../api/recipes';

export default function LogMealModal({ onLog, onClose }) {
  const ref = useRef(null);
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRecipes().then(setRecipes).catch(() => setError('Failed to load recipes'));
    ref.current?.showModal();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!recipeId) return setError('Select a recipe');
    setError('');
    try {
      await onLog({ recipe_id: Number(recipeId), servings: Number(servings), notes: notes.trim() || undefined });
      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  function close() { ref.current?.close(); onClose(); }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Log a Meal</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Recipe</label>
          <select value={recipeId} onChange={e => setRecipeId(e.target.value)} required>
            <option value="">— Select a recipe —</option>
            {recipes.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.serving_size})</option>
            ))}
          </select>
        </div>
        <div>
          <label>Servings</label>
          <input type="number" min="0.25" step="0.25" value={servings} onChange={e => setServings(e.target.value)} required />
        </div>
        <div>
          <label>Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. post-workout" />
        </div>
        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary">Log Meal</button>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 8: Implement Dashboard page**

Replace `client/src/pages/Dashboard.jsx` with:
```jsx
import { useEffect, useState } from 'react';
import LogEntryRow from '../components/LogEntryRow';
import LogMealModal from '../components/LogMealModal';
import MacroTotals from '../components/MacroTotals';
import { fetchLogForDate, createLogEntry, deleteLogEntry } from '../api/log';
import { sumMacros } from '../utils/macros';
import { useTargets } from '../hooks/useTargets';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const MACRO_LABELS = { calories: 'Calories', protein_g: 'Protein (g)', carbs_g: 'Carbs (g)', fat_g: 'Fat (g)' };

export default function Dashboard() {
  const today = todayISO();
  const [entries, setEntries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const { targets, setTarget } = useTargets();

  useEffect(() => { load(); }, []);

  async function load() {
    try { setEntries(await fetchLogForDate(today)); }
    catch (e) { setError(e.message); }
  }

  async function handleLog(data) {
    await createLogEntry({ ...data, date: today });
    load();
  }

  async function handleDelete(entry) {
    try { await deleteLogEntry(entry.id); load(); }
    catch (e) { setError(e.message); }
  }

  const totals = sumMacros(entries);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Today</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>{today}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Log a Meal</button>
      </div>

      {error && <p className="error">{error}</p>}

      <MacroTotals totals={totals} targets={targets} />

      <div className="card" style={{ marginBottom: 16 }}>
        {entries.length === 0
          ? <p className="empty-state">No meals logged today. Hit "+ Log a Meal" to get started.</p>
          : entries.map(entry => <LogEntryRow key={entry.id} entry={entry} onDelete={handleDelete} />)
        }
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: 13, userSelect: 'none' }}>Set daily targets</summary>
        <div className="card" style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Object.entries(MACRO_LABELS).map(([macro, label]) => (
            <div key={macro}>
              <label style={{ fontSize: 12 }}>{label}</label>
              <input
                type="number" min="0" step="1"
                style={{ width: 100 }}
                value={targets[macro] ?? ''}
                onChange={e => setTarget(macro, e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </details>

      {showModal && <LogMealModal onLog={handleLog} onClose={() => setShowModal(false)} />}
    </div>
  );
}
```

- [ ] **Step 9: Verify the Dashboard end-to-end**

With both servers running, open http://localhost:5173. Verify:
- "Today" heading with today's date visible
- MacroTotals card shows zeros
- "+ Log a Meal" opens a modal with a recipe dropdown (requires at least one recipe in the library)
- Logging a meal adds it to the list and updates macro totals
- "✕" removes a meal entry
- Expanding "Set daily targets" shows four number inputs
- Entering a calorie target shows a progress bar in the macro totals card

- [ ] **Step 10: Commit**

```bash
git add client/src/hooks/ client/src/components/MacroTotals.jsx client/src/components/LogEntryRow.jsx client/src/components/LogMealModal.jsx client/src/pages/Dashboard.jsx
git commit -m "feat: Dashboard page with meal logging, macro totals, and targets"
```

---

### Task 10: History & Trends page

**Files:**
- Create: `client/src/components/RangeSelector.jsx`
- Modify: `client/src/pages/History.jsx`

- [ ] **Step 1: Create RangeSelector component**

Create `client/src/components/RangeSelector.jsx`:
```jsx
const OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

export default function RangeSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={value === opt.value ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement History page**

Replace `client/src/pages/History.jsx` with:
```jsx
import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import RangeSelector from '../components/RangeSelector';
import LogEntryRow from '../components/LogEntryRow';
import { fetchLogRange, fetchLogForDate } from '../api/log';
import { groupByDate } from '../utils/macros';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getRangeStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export default function History() {
  const [range, setRange] = useState(30);
  const [chartData, setChartData] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [dayEntries, setDayEntries] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { loadRange(); }, [range]);

  async function loadRange() {
    try {
      const entries = await fetchLogRange(getRangeStart(range), todayISO());
      setChartData(groupByDate(entries));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDateChange(e) {
    const date = e.target.value;
    setSelectedDate(date);
    if (!date) { setDayEntries([]); return; }
    try { setDayEntries(await fetchLogForDate(date)); }
    catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>History & Trends</h1>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Calories — last {range} days</h3>
        {chartData.length === 0 ? (
          <p className="empty-state">No data in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="calories" stroke="#f59e0b" strokeWidth={2} dot={false} name="Calories" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Macro breakdown — last {range} days</h3>
        {chartData.length === 0 ? (
          <p className="empty-state">No data in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="protein_g" stackId="a" fill="#3b82f6" name="Protein (g)" />
              <Bar dataKey="carbs_g"   stackId="a" fill="#10b981" name="Carbs (g)" />
              <Bar dataKey="fat_g"     stackId="a" fill="#ef4444" name="Fat (g)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Browse a day</h3>
        <input
          type="date"
          value={selectedDate}
          max={todayISO()}
          onChange={handleDateChange}
          style={{ marginBottom: 12, width: 'auto' }}
        />
        {selectedDate && (
          dayEntries.length === 0
            ? <p className="empty-state">No meals logged on {selectedDate}.</p>
            : dayEntries.map(entry => <LogEntryRow key={entry.id} entry={entry} onDelete={null} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run all tests one final time**

Run:
```bash
cd server && npm test
cd ../client && npm test
```
Expected: All tests pass in both suites.

- [ ] **Step 4: Verify the History page end-to-end**

With both servers running, open http://localhost:5173/history. Verify:
- "History & Trends" heading with 7/30/90 range buttons
- Empty state charts shown when no data exists
- After logging meals on the Dashboard, returning here shows charts populated
- Switching range buttons re-fetches and redraws charts
- Date picker shows the meal log for the selected date

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RangeSelector.jsx client/src/pages/History.jsx
git commit -m "feat: History & Trends page with calorie and macro charts"
```

---

## Running the App

```bash
# Terminal 1 — API server (port 3001)
cd server && node index.js

# Terminal 2 — React dev server (port 5173)
cd client && npm run dev
```

Open http://localhost:5173
