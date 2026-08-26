/**
 * Ingredients that carried macros but could never be logged: tracking_type
 * 'weight' with no grams per serving, while unit_name/serving_quantity
 * described a perfectly good serving. The app reported "needs grams per serving
 * before it can be logged" on an ingredient whose serving was right there.
 */
const request = require('supertest');
const express = require('express');
const { createDb, repairHybridIngredientTracking } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');
const { createLogRouter } = require('../routes/log');
const { createRecipesRouter } = require('../routes/recipes');
const { ingredientMacrosForAmount } = require('../recipeIngredients');

function buildApp(db = createDb(':memory:')) {
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  app.use('/api/log', createLogRouter(db));
  app.use('/api/recipes', createRecipesRouter(db));
  return { app, db };
}

/** Insert the exact broken shape found in the real database. */
function seedHybrid(db, over = {}) {
  const row = {
    name: 'Kroger Carb Smart Vanilla Yogurt',
    serving_size_text: '1 serving',
    tracking_type: 'weight',
    grams_per_serving: null,
    unit_name: 'serving',
    serving_quantity: 1,
    ...over,
  };
  const r = db
    .prepare(
      `INSERT INTO label_ingredients
         (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g,
          source_type, tracking_type, unit_name, serving_quantity)
       VALUES (0, @name, @serving_size_text, @grams_per_serving, 100, 5, 10, 3,
               'manual', @tracking_type, @unit_name, @serving_quantity)`
    )
    .run(row);
  return r.lastInsertRowid;
}

const read = (db, id) =>
  db.prepare('SELECT * FROM label_ingredients WHERE id = ?').get(id);

describe('repairHybridIngredientTracking', () => {
  it('makes an unloggable hybrid row loggable again, with its saved macros', () => {
    const db = createDb(':memory:');
    const id = seedHybrid(db);
    expect(ingredientMacrosForAmount(read(db, id), 1, 'serving')).toBeNull();

    expect(repairHybridIngredientTracking(db)).toBe(1);

    const fixed = read(db, id);
    expect(fixed.tracking_type).toBe('unit');
    expect(ingredientMacrosForAmount(fixed, 1, 'serving').calories).toBe(100);
    expect(ingredientMacrosForAmount(fixed, 2, 'serving').calories).toBe(200);
  });

  it('fills in a missing unit name rather than leaving it nameless', () => {
    const db = createDb(':memory:');
    const id = seedHybrid(db, { unit_name: null, serving_quantity: 1 });
    repairHybridIngredientTracking(db);
    const fixed = read(db, id);
    expect(fixed.unit_name).toBe('serving');
    expect(fixed.serving_quantity).toBe(1);
  });

  it('leaves healthy weight-tracked ingredients alone', () => {
    const db = createDb(':memory:');
    const id = seedHybrid(db, { grams_per_serving: 100, unit_name: null, serving_quantity: null });
    expect(repairHybridIngredientTracking(db)).toBe(0);
    expect(read(db, id).tracking_type).toBe('weight');
  });

  it('leaves genuinely incomplete rows for the user to fix', () => {
    // No grams AND no unit information: nothing describes a serving, so there
    // is nothing to infer. This one really does need editing.
    const db = createDb(':memory:');
    const id = seedHybrid(db, { unit_name: null, serving_quantity: null });
    expect(repairHybridIngredientTracking(db)).toBe(0);
    expect(read(db, id).tracking_type).toBe('weight');
  });

  it('is idempotent', () => {
    const db = createDb(':memory:');
    seedHybrid(db);
    expect(repairHybridIngredientTracking(db)).toBe(1);
    expect(repairHybridIngredientTracking(db)).toBe(0);
  });

  it('runs at boot, so an existing database heals itself', () => {
    const db = createDb(':memory:');
    const id = seedHybrid(db);
    // createDb runs its migrations on open; re-opening the same handle is not
    // possible in memory, so invoke the boot repair the way createDb does.
    repairHybridIngredientTracking(db);
    expect(read(db, id).tracking_type).toBe('unit');
  });
});

describe('the write path no longer creates hybrids', () => {
  it('stores a unit-shaped serving as unit-tracked when tracking_type is omitted', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/label-ingredients').send({
      name: 'Some yogurt',
      serving_size_text: '1 serving',
      calories: 100, protein_g: 5, carbs_g: 10, fat_g: 3,
      unit_name: 'serving', serving_quantity: 1,
    });
    expect(res.status).toBe(201);
    expect(read(db, res.body.id).tracking_type).toBe('unit');
  });

  it('still stores a grams-per-serving ingredient as weight-tracked', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/label-ingredients').send({
      name: 'Oats', serving_size_text: '40 g',
      calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
      grams_per_serving: 40,
    });
    expect(read(db, res.body.id).tracking_type).toBe('weight');
  });

  it('respects an explicit choice from the client', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/label-ingredients').send({
      name: 'Explicit', serving_size_text: '1 scoop',
      calories: 10, protein_g: 0, carbs_g: 0, fat_g: 0,
      tracking_type: 'unit', unit_name: 'scoop', serving_quantity: 1,
    });
    expect(read(db, res.body.id).tracking_type).toBe('unit');
  });
});

describe('a repaired ingredient logs end to end', () => {
  it('logs the yogurt that used to be refused', async () => {
    const { app, db } = buildApp();
    // Create it the way the app does, then put it into the broken state, so the
    // row is owned by the same user the API resolves.
    const created = await request(app).post('/api/label-ingredients').send({
      name: 'Kroger Carb Smart Vanilla Yogurt', serving_size_text: '1 serving',
      calories: 100, protein_g: 5, carbs_g: 10, fat_g: 3,
      tracking_type: 'unit', unit_name: 'serving', serving_quantity: 1,
    });
    const id = created.body.id;
    db.prepare(
      `UPDATE label_ingredients SET tracking_type = 'weight', grams_per_serving = NULL WHERE id = ?`
    ).run(id);

    const recipe = await request(app).post('/api/recipes').send({
      name: 'Test meal', serving_size: '1', calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1,
    });

    // Broken: refused, which is what the user saw.
    const before = await request(app).post('/api/log').send({
      recipe_id: recipe.body.id, date: '2026-08-25', servings: 1,
      ingredients: [{ name: 'Yogurt', label_ingredient_id: id, amount: 2, unit: 'serving' }],
    });
    expect(before.status).toBe(400);

    expect(repairHybridIngredientTracking(db)).toBe(1);
    const res = await request(app).post('/api/log').send({
      recipe_id: recipe.body.id, date: '2026-08-25', servings: 1,
      ingredients: [{ name: 'Yogurt', label_ingredient_id: id, amount: 2, unit: 'serving' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.recipe_calories).toBeCloseTo(200, 1);
  });
});
