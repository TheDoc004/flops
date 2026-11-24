#!/usr/bin/env node
/**
 * Seeds a throwaway DEMO database for screenshots and local poking — never a
 * real one. Every row goes through the app's own routes (in-process), so the
 * demo data is shaped exactly like data the UI writes.
 *
 *   cd server && npm run demo:seed            # → ../.demo/demo.db (gitignored)
 *   node scripts/seed-demo.js --db /tmp/x.db  # any path inside .demo/ or the OS temp dir
 *
 * The target file is recreated from scratch each run. Anything outside .demo/
 * or the temp dir — /var/data, server/nutrition.db, a copied production DB —
 * is refused, so this can't overwrite real data by accident.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createDb } = require('../db');
const { createApp } = require('../createApp');
const { createSession, findOrCreateEmailUser } = require('../authService');
const writes = require('../mcp/writes');
const { getLocalDateISO } = require('../mcp/dates');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEMO_DIR = path.join(REPO_ROOT, '.demo');
const DEMO_EMAIL = 'demo@flops.example';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function resolveTarget() {
  const raw = argValue('--db') || process.env.DEMO_DB_PATH || path.join(DEMO_DIR, 'demo.db');
  const target = path.resolve(raw);
  const allowedRoots = [DEMO_DIR, fs.realpathSync(os.tmpdir()), path.resolve(os.tmpdir())];
  const inside = allowedRoots.some(root => target.startsWith(root + path.sep));
  if (!inside || target.startsWith('/var/data') || path.basename(target) === 'nutrition.db') {
    throw new Error(`Refusing to seed ${target}: demo DBs live in ${DEMO_DIR} or the OS temp dir.`);
  }
  return target;
}

function freshDb(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
  return createDb(target);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return getLocalDateISO(d);
}

function isoWeekday(iso) {
  const day = new Date(`${iso}T12:00:00`).getDay();
  return day === 0 ? 7 : day;
}

/** Small deterministic jitter so charts look lived-in but runs are repeatable. */
function wobble(i, spread) {
  return Math.round(Math.sin(i * 1.7) * spread);
}

async function seed(db) {
  const app = createApp(db, { cors: false });
  const user = findOrCreateEmailUser(db, DEMO_EMAIL);
  const h = { Authorization: `Bearer ${createSession(db, user.id).token}` };

  async function call(method, url, body, expected = [200, 201, 204]) {
    const res = await request(app)[method](url).set(h).send(body);
    if (!expected.includes(res.status)) {
      throw new Error(`${method.toUpperCase()} ${url} → ${res.status} ${res.text}`);
    }
    return res.body;
  }

  await call('patch', '/api/auth/me', { display_name: 'Demo Athlete', onboarding_completed: true });
  await call('put', '/api/profile', {
    height_cm: 178, weight_kg: 80, age: 29, sex: 'male', goal_weight_kg: 76,
    activity_level: 'moderate', maintenance_calories: 2600, macro_units: 'metric', body_units: 'metric',
  });

  const goals = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({
    weekday,
    calories_min: 2100, calories_max: 2400,
    protein_g_min: 160, protein_g_max: 200,
    carbs_g_min: 200, carbs_g_max: 280,
    fat_g_min: 55, fat_g_max: 80,
  }));
  await call('put', '/api/goals', { effective_start_date: daysAgo(60), goals });

  const foods = {};
  const FOODS = [
    ['Rolled Oats', '40 g', 40, 150, 5, 27, 3, 4],
    ['Greek Yogurt 0%', '170 g', 170, 100, 18, 6, 0, 0],
    ['Chicken Breast', '100 g', 100, 165, 31, 0, 3.6, 0],
    ['Jasmine Rice (cooked)', '150 g', 150, 195, 4, 42, 0.4, 0.6],
    ['Broccoli', '85 g', 85, 30, 2.5, 6, 0.3, 2.2],
    ['Banana', '118 g', 118, 105, 1.3, 27, 0.4, 3.1],
    ['Whey Protein', '31 g', 31, 120, 24, 3, 1.5, 0],
    ['Salmon Fillet', '113 g', 113, 230, 25, 0, 14, 0],
    ['Sweet Potato', '130 g', 130, 112, 2, 26, 0.1, 3.9],
    ['Olive Oil', '14 g', 14, 120, 0, 0, 14, 0],
  ];
  for (const [name, serving, gps, cal, p, c, f, fiber] of FOODS) {
    const row = await call('post', '/api/label-ingredients', {
      name, serving_size_text: serving, grams_per_serving: gps,
      calories: cal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fiber, source_type: 'manual',
    });
    foods[name] = row.id;
  }

  const RECIPES = [
    ['Overnight Oats', 480, 38, 62, 9, 7, [['Rolled Oats', '80 g'], ['Greek Yogurt 0%', '170 g'], ['Banana', '1 medium']]],
    ['Chicken Rice Bowl', 620, 52, 68, 12, 4, [['Chicken Breast', '150 g'], ['Jasmine Rice (cooked)', '200 g'], ['Broccoli', '85 g']]],
    ['Salmon & Sweet Potato', 560, 36, 40, 24, 6, [['Salmon Fillet', '140 g'], ['Sweet Potato', '200 g'], ['Olive Oil', '5 g']]],
    ['Protein Shake', 240, 30, 30, 2, 3, [['Whey Protein', '31 g'], ['Banana', '1 medium']]],
  ];
  const recipes = {};
  for (const [name, cal, p, c, f, fiber, ingredients] of RECIPES) {
    const row = await call('post', '/api/recipes', {
      name, serving_size: 1, calories: cal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fiber,
      ingredients: ingredients.map(([n, amount]) => ({ name: n, amount })),
    });
    recipes[name] = row.id;
  }

  const prep = writes.createMealPrep(db, user.id, {
    name: 'Sunday Chicken Prep',
    servings: 4,
    weight_basis: 'cooked',
    items: [
      { label_ingredient_id: foods['Chicken Breast'], quantity_g: 600, nutrition_source: 'label' },
      { label_ingredient_id: foods['Jasmine Rice (cooked)'], quantity_g: 800, nutrition_source: 'label' },
      { label_ingredient_id: foods.Broccoli, quantity_g: 340, nutrition_source: 'label' },
    ],
  });
  if (prep.error) throw new Error(`meal prep: ${prep.error}`);

  // Two weeks of meals, ending today, plus a lighter morning-only today.
  for (let i = 13; i >= 0; i -= 1) {
    const date = daysAgo(i);
    await call('post', '/api/log', { recipe_id: recipes['Overnight Oats'], date, servings: 1, time_min: 8 * 60 });
    if (i === 0) continue;
    await call('post', '/api/log', { recipe_id: recipes['Chicken Rice Bowl'], date, servings: 1, time_min: 13 * 60 });
    await call('post', '/api/log', {
      recipe_id: recipes[i % 2 ? 'Salmon & Sweet Potato' : 'Chicken Rice Bowl'], date, servings: 1, time_min: 19 * 60,
    });
    await call('post', '/api/log', { recipe_id: recipes['Protein Shake'], date, servings: 1, time_min: 16 * 60 });
    if (i % 3 === 0) {
      await call('post', '/api/log/custom', {
        date, name: 'Coffee with milk', servings: 1, calories: 60 + wobble(i, 10), protein_g: 3, carbs_g: 5, fat_g: 3, time_min: 10 * 60,
      });
    }
    if (i % 4 === 1) {
      await call('post', '/api/log/quick-food', {
        date, name: 'Trail mix', amount: 40, unit: 'g',
        calories_100g: 480, protein_g_100g: 14, carbs_g_100g: 45, fat_g_100g: 29, time_min: 15 * 60,
      });
    }
  }

  for (let i = 45; i >= 0; i -= 1) {
    if (i % 2 && i > 3) continue;
    const kg = 81.6 - (45 - i) * 0.05 + wobble(i, 3) / 10;
    await call('put', '/api/body-weights', { date: daysAgo(i), weight_kg: Math.round(kg * 10) / 10 });
  }

  await call('post', '/api/diet-phases', { label: 'Maintenance', kind: 'maintenance', start_date: daysAgo(75), end_date: daysAgo(31) });
  await call('post', '/api/diet-phases', { label: 'Lean cut', kind: 'cut', start_date: daysAgo(30), notes: '-400 kcal, 0.5 kg/week' });
  await call('post', '/api/diet-phases', { label: 'Deload week', kind: 'recovery', start_date: daysAgo(10), end_date: daysAgo(4) });

  const SUPPS = [
    { name: 'Creatine Monohydrate', dose_text: '5 g', label_serving_qty: 5, label_serving_unit: 'g', dose_qty: 5 },
    { name: 'Vitamin D3', dose_text: '1 softgel', label_serving_qty: 1, label_serving_unit: 'softgel', dose_qty: 1 },
    { name: 'Fish Oil', dose_text: '2 softgels', label_serving_qty: 2, label_serving_unit: 'softgel', dose_qty: 2, calories: 20, fat_g: 2, counts_toward_macros: 1 },
  ];
  const supps = [];
  for (const s of SUPPS) supps.push(await call('post', '/api/supplements', s));
  for (let i = 13; i >= 0; i -= 1) {
    for (const [k, s] of supps.entries()) {
      if (i === 0 && k > 0) continue;
      if ((i + k) % 5 === 4) continue;
      await call('put', '/api/supplements/log', { date: daysAgo(i), supplement_id: s.id, taken: 1 });
    }
  }

  const exercises = {};
  for (const name of ['Barbell Bench Press', 'Overhead Press', 'Tricep Pushdown', 'Barbell Row', 'Lat Pulldown',
    'Barbell Curl', 'Barbell Back Squat', 'Romanian Deadlift', 'Leg Press']) {
    const row = db.prepare('SELECT id FROM gym_exercises WHERE user_id = 0 AND name = ? AND is_deleted = 0').get(name);
    if (!row) throw new Error(`catalog exercise missing: ${name}`);
    exercises[name] = row.id;
  }
  const TEMPLATES = [
    ['Push', 'PPL', [['Barbell Bench Press', 4, 6, 185], ['Overhead Press', 3, 8, 115], ['Tricep Pushdown', 3, 12, 60]]],
    ['Pull', 'PPL', [['Barbell Row', 4, 8, 165], ['Lat Pulldown', 3, 10, 140], ['Barbell Curl', 3, 10, 70]]],
    ['Legs', 'PPL', [['Barbell Back Squat', 4, 5, 245], ['Romanian Deadlift', 3, 8, 205], ['Leg Press', 3, 12, 360]]],
  ];
  const templates = [];
  for (const [name, split, items] of TEMPLATES) {
    const t = await call('post', '/api/gym/templates', { name, split_label: split });
    for (const [ex, sets, reps, weight] of items) {
      await call('post', `/api/gym/templates/${t.id}/exercises`, {
        exercise_id: exercises[ex], target_sets: sets, target_reps: reps, target_weight: weight, rest_sec: 120,
      });
    }
    templates.push({ ...t, items });
  }
  const scheduleDays = { 1: 0, 3: 1, 5: 2 };
  await call('put', '/api/gym/schedule', {
    days: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({
      weekday,
      enabled: weekday in scheduleDays,
      template_id: weekday in scheduleDays ? templates[scheduleDays[weekday]].id : null,
      duration_min: weekday in scheduleDays ? 60 : null,
    })),
  });

  // Six weeks of the schedule, with a slow, believable progression.
  for (let i = 42; i >= 1; i -= 1) {
    const date = daysAgo(i);
    const slot = scheduleDays[isoWeekday(date)];
    if (slot === undefined) continue;
    const tpl = templates[slot];
    const week = Math.floor((42 - i) / 7);
    const session = await call('post', '/api/gym/sessions', { date, template_id: tpl.id, activity_type: 'strength' });
    for (const [ex, sets, reps, weight] of tpl.items) {
      for (let s = 0; s < sets; s += 1) {
        await call('post', `/api/gym/sessions/${session.id}/sets`, {
          exercise_id: exercises[ex], reps: reps - (s === sets - 1 ? 1 : 0), weight: weight - 10 + week * 2.5, weight_unit: 'lb',
        });
      }
    }
    await call('put', `/api/gym/sessions/${session.id}`, { finish: true, duration_sec: 55 * 60 + wobble(i, 300) });
  }
  await call('put', `/api/gym/one-rm/${exercises['Barbell Bench Press']}`, { estimated: 225, formula: 'epley' });

  return { user, counts: summarize(db, user.id) };
}

function summarize(db, userId) {
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId).n;
  return Object.fromEntries(
    ['label_ingredients', 'recipes', 'log_entries', 'body_weights', 'diet_phases', 'supplements',
      'supplement_log', 'gym_templates', 'gym_sessions', 'gym_sets'].map(t => [t, count(t)])
  );
}

async function main() {
  const target = resolveTarget();
  const db = freshDb(target);
  const { user, counts } = await seed(db);
  db.close();
  console.log(`Demo DB ready: ${target}`);
  console.log(`Demo user: ${user.email} (sign in with the AUTH_DEV one-time code)`);
  console.log(counts);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { seed, resolveTarget, DEMO_EMAIL };
