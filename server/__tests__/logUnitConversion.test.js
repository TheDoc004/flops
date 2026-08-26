/**
 * End-to-end proof that a saved ingredient can be logged in a unit other than
 * the one it was recorded in, and that the macros land where they should.
 */
const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLogRouter } = require('../routes/log');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');
const { createRecipesRouter } = require('../routes/recipes');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/log', createLogRouter(db));
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  app.use('/api/recipes', createRecipesRouter(db));
  return app;
}

/**
 * A meal to log against. The receipt rows posted with the log are what actually
 * decide the macros, so the recipe's own numbers are deliberately nothing like
 * the expected results.
 */
async function seedRecipe(app) {
  const res = await request(app).post('/api/recipes').send({
    name: 'Test meal', serving_size: '1', calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** Nonfat milk recorded exactly as the user would: macros for 1 cup, 1 cup = 245 g. */
async function seedMilk(app) {
  const res = await request(app).post('/api/label-ingredients').send({
    name: 'Nonfat milk',
    serving_size_text: '1 cup',
    calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5,
    tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: 245,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** Salmon recorded per filet, one filet weighing 170 g. */
async function seedSalmon(app) {
  const res = await request(app).post('/api/label-ingredients').send({
    name: 'Salmon',
    serving_size_text: '1 filet',
    calories: 350, protein_g: 34, carbs_g: 0, fat_g: 22,
    tracking_type: 'unit', unit_name: 'filet', serving_quantity: 1, grams_per_unit: 170,
  });
  expect(res.status).toBe(201);
  return res.body;
}

const logRow = (app, recipe, ing, amount, unit) =>
  request(app).post('/api/log').send({
    recipe_id: recipe.id,
    date: '2026-08-25',
    servings: 1,
    ingredients: [{ name: ing.name, label_ingredient_id: ing.id, amount, unit }],
  });

describe('logging a per-cup ingredient in another unit', () => {
  it('logs 200 ml of a milk recorded per cup', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const milk = await seedMilk(app);
    const res = await logRow(app, recipe, milk, 200, 'ml');
    expect(res.status).toBe(201);
    // 200 ml is 0.8454 of a 236.588 ml cup.
    expect(res.body.recipe_calories).toBeCloseTo(90 * (200 / 236.5882365), 1);
    expect(res.body.recipe_protein_g).toBeCloseTo(9 * (200 / 236.5882365), 1);
  });

  it('logs 7 oz of that same milk, by weight, through the gram equivalent', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const milk = await seedMilk(app);
    const res = await logRow(app, recipe, milk, 7, 'oz');
    expect(res.status).toBe(201);
    // 7 oz is 198.4 g, and one cup weighs 245 g.
    expect(res.body.recipe_calories).toBeCloseTo(90 * ((7 * 28.349523125) / 245), 1);
  });

  it('still logs it in cups, unchanged', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const milk = await seedMilk(app);
    const res = await logRow(app, recipe, milk, 2, 'cup');
    expect(res.status).toBe(201);
    expect(res.body.recipe_calories).toBeCloseTo(180, 1);
  });

  it('shows the row in the unit it was logged in', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const milk = await seedMilk(app);
    await logRow(app, recipe, milk, 200, 'ml');
    const day = await request(app).get('/api/log?date=2026-08-25');
    const rows = JSON.parse(day.body[0].ingredients_json);
    expect(rows[0].unit).toBe('ml');
    expect(rows[0].amount).toBe(200);
  });
});

describe('logging a per-filet ingredient by weight', () => {
  it('logs 340 g as two filets worth of macros', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const salmon = await seedSalmon(app);
    const res = await logRow(app, recipe, salmon, 340, 'g');
    expect(res.status).toBe(201);
    expect(res.body.recipe_calories).toBeCloseTo(700, 0);
  });

  it('logs 1 filet as one filet', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const salmon = await seedSalmon(app);
    const res = await logRow(app, recipe, salmon, 1, 'filet');
    expect(res.status).toBe(201);
    expect(res.body.recipe_calories).toBeCloseTo(350, 1);
  });
});

describe('units that cannot be converted are refused, not guessed', () => {
  it('rejects a volume against a per-filet ingredient', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const salmon = await seedSalmon(app);
    const res = await logRow(app, recipe, salmon, 100, 'ml');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can’t be measured in ml/);
  });

  it('rejects a foreign count unit instead of scaling it', async () => {
    // The old behaviour: "2 slices" silently became two filets, 700 calories.
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const salmon = await seedSalmon(app);
    const res = await logRow(app, recipe, salmon, 2, 'slice');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can’t be measured in slice/);
  });

  it('rejects a weight for a per-unit ingredient with no gram equivalent', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const created = await request(app).post('/api/label-ingredients').send({
      name: 'Protein powder', serving_size_text: '1 scoop',
      calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5,
      tracking_type: 'unit', unit_name: 'scoop', serving_quantity: 1,
    });
    const res = await logRow(app, recipe, created.body, 31, 'g');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gram equivalent/);
  });
});

describe('grams-per-serving ingredients are unchanged', () => {
  it('logs in grams and ounces, and refuses volumes', async () => {
    const app = buildApp();
    const recipe = await seedRecipe(app);
    const created = await request(app).post('/api/label-ingredients').send({
      name: 'Oats', serving_size_text: '40 g',
      calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3,
      tracking_type: 'weight', grams_per_serving: 40,
    });
    const oats = created.body;

    const inGrams = await logRow(app, recipe, oats, 80, 'g');
    expect(inGrams.body.recipe_calories).toBeCloseTo(300, 1);

    const inOunces = await logRow(app, recipe, oats, 2, 'oz');
    expect(inOunces.body.recipe_calories).toBeCloseTo(150 * ((2 * 28.349523125) / 40), 1);

    const inMl = await logRow(app, recipe, oats, 100, 'ml');
    expect(inMl.status).toBe(400);
  });
});
