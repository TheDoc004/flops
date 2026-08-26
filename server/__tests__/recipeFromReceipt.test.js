/**
 * The payload the log modal's "Save as Recipe" produces, checked against the
 * real API — a recipe built from a receipt has to come back loggable, in the
 * units it was saved with.
 */
const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');
const { createRecipesRouter } = require('../routes/recipes');
const { createLogRouter } = require('../routes/log');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/log', createLogRouter(db));
  return app;
}

const seedMilk = app =>
  request(app).post('/api/label-ingredients').send({
    name: 'Nonfat milk', serving_size_text: '1 cup',
    calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5,
    tracking_type: 'unit', unit_name: 'cup', serving_quantity: 1, grams_per_unit: 245,
  });

describe('a recipe saved from a log receipt', () => {
  it('accepts library lines in the unit they were measured in', async () => {
    const app = buildApp();
    const milk = (await seedMilk(app)).body;

    const res = await request(app).post('/api/recipes').send({
      name: 'Morning shake',
      serving_size: '1 meal',
      calories: 76.1, protein_g: 7.61, carbs_g: 10.99, fat_g: 0.42, fiber_g: 0,
      ingredients: [
        { kind: 'ingredient', name: 'Nonfat milk', amount: '200', unit: 'ml', label_ingredient_id: milk.id },
        { kind: 'line', name: 'Cinnamon', amount: 'as logged' },
      ],
      meal_builder_meta: { source: 'log_receipt' },
    });

    expect(res.status).toBe(201);
    expect(res.body.ingredients).toEqual([
      { kind: 'ingredient', name: 'Nonfat milk', amount: '200', unit: 'ml', label_ingredient_id: milk.id },
      { kind: 'line', name: 'Cinnamon', amount: 'as logged' },
    ]);
  });

  it('folds a unit spelling rather than storing two of the same unit', async () => {
    const app = buildApp();
    const milk = (await seedMilk(app)).body;
    const res = await request(app).post('/api/recipes').send({
      name: 'Shake', serving_size: '1 meal',
      calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5,
      ingredients: [{ kind: 'ingredient', name: 'Nonfat milk', amount: '1', unit: 'Cups', label_ingredient_id: milk.id }],
    });
    expect(res.body.ingredients[0].unit).toBe('cup');
  });

  it('logs back at the amount it was saved with', async () => {
    const app = buildApp();
    const milk = (await seedMilk(app)).body;
    const recipe = await request(app).post('/api/recipes').send({
      name: 'Morning shake', serving_size: '1 meal',
      calories: 76.1, protein_g: 7.61, carbs_g: 10.99, fat_g: 0.42,
      ingredients: [{ kind: 'ingredient', name: 'Nonfat milk', amount: '200', unit: 'ml', label_ingredient_id: milk.id }],
    });

    // Logging with no receipt override falls back to the recipe's own lines.
    const res = await request(app).post('/api/log').send({
      recipe_id: recipe.body.id, date: '2026-08-25', servings: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.recipe_calories).toBeCloseTo(90 * (200 / 236.5882365), 1);
  });

  it('rejects a line pointing at an ingredient that is not yours', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/recipes').send({
      name: 'Bogus', serving_size: '1 meal',
      calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1,
      ingredients: [{ kind: 'ingredient', name: 'Ghost', amount: '1', unit: 'g', label_ingredient_id: 99999 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown label ingredient/);
  });
});
