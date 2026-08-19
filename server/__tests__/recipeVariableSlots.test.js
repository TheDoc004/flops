const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createRecipesRouter } = require('../routes/recipes');
const { createLogRouter } = require('../routes/log');
const {
  parseIngredientsJson,
  listRecipeIngredientLines,
  resolveReceiptForLog,
} = require('../recipeIngredients');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/recipes', createRecipesRouter(db));
  app.use('/api/log', createLogRouter(db));
  return { app, db };
}

describe('Recipe ingredient lists + log receipts', () => {
  it('migrates legacy slots to ingredient lines on parse (default option only)', () => {
    const parsed = parseIngredientsJson(JSON.stringify([
      {
        kind: 'slot',
        slot_id: 's1',
        label: 'Yogurt',
        amount: '170',
        unit: 'g',
        option_label_ingredient_ids: [10, 11, 12],
      },
    ]));
    expect(parsed).toEqual([
      { kind: 'ingredient', name: 'Yogurt', amount: '170', unit: 'g', label_ingredient_id: 10 },
    ]);
  });

  it('POST /api/recipes accepts kind:ingredient and rejects unknown ids', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Brand A', '100g', 100, 100, 10, 10, 5, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Yogurt bowl',
        serving_size: '1 bowl',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 5,
        ingredients: [
          { kind: 'ingredient', name: 'Brand A', amount: '100', unit: 'g', label_ingredient_id: id1 },
        ],
      })
      .expect(201);

    expect(recipe.ingredients[0]).toMatchObject({
      kind: 'ingredient',
      label_ingredient_id: id1,
      amount: '100',
    });

    await request(app)
      .post('/api/recipes')
      .send({
        name: 'Bad',
        serving_size: '1',
        calories: 1,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        ingredients: [
          { kind: 'ingredient', name: 'Nope', amount: '10', unit: 'g', label_ingredient_id: 999999 },
        ],
      })
      .expect(400);
  });

  it('POST /api/log with freeform ingredients receipt stores macros + ingredients_json', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Brand A', '100g', 100, 100, 10, 10, 5, 'manual')`
      )
      .run();
    const r2 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Brand B', '100g', 100, 200, 20, 20, 10, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);
    const id2 = Number(r2.lastInsertRowid);

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Breakfast',
        serving_size: '1 meal',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 5,
        ingredients: [
          { kind: 'ingredient', name: 'Brand A', amount: '100', unit: 'g', label_ingredient_id: id1 },
        ],
      })
      .expect(201);

    const logRes = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-01',
        servings: 1,
        ingredients: [
          { name: 'Brand A', amount: 100, unit: 'g', label_ingredient_id: id1 },
          { name: 'Brand B', amount: 50, unit: 'g', label_ingredient_id: id2 },
        ],
      })
      .expect(201);

    // 100 + half of 200 = 200 cal
    expect(Number(logRes.body.recipe_calories)).toBeCloseTo(200, 5);
    expect(logRes.body.recipe_name).toBe('Breakfast');
    expect(logRes.body.recipe_id).toBe(recipe.id);

    const row = db.prepare('SELECT ingredients_json, slot_selections_json FROM log_entries WHERE id = ?').get(logRes.body.id);
    expect(row.slot_selections_json).toBeNull();
    const ings = JSON.parse(row.ingredients_json);
    expect(ings).toHaveLength(2);
    expect(ings.map(x => x.label_ingredient_id).sort()).toEqual([id1, id2].sort());
  });

  it('legacy slot recipes still seed listRecipeIngredientLines with default id only', () => {
    const recipeRow = {
      ingredients: JSON.stringify([
        {
          kind: 'slot',
          slot_id: 's1',
          label: 'Toast',
          amount: '90',
          unit: 'g',
          option_label_ingredient_ids: [5, 6],
        },
      ]),
      meal_builder_meta: null,
    };
    const lines = listRecipeIngredientLines(recipeRow);
    expect(lines).toEqual([
      { kind: 'ingredient', name: 'Toast', amount: '90', unit: 'g', label_ingredient_id: 5 },
    ]);
  });

  it('resolveReceiptForLog recomputes from library amounts', () => {
    const { db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Oats', '40g', 40, 150, 5, 27, 3, 'manual')`
      )
      .run();
    const id = Number(r1.lastInsertRowid);
    const { rows, perServing } = resolveReceiptForLog(db, [
      { name: 'Oats', amount: 80, unit: 'g', label_ingredient_id: id },
    ], 1);
    expect(rows).toHaveLength(1);
    expect(perServing.calories).toBeCloseTo(300, 5);
    expect(perServing.protein_g).toBeCloseTo(10, 5);
  });

  it('PUT /api/log/:id accepts an edited receipt', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Egg', '1 egg', 50, 70, 6, 0.5, 5, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Eggs',
        serving_size: '1 meal',
        calories: 70,
        protein_g: 6,
        carbs_g: 0.5,
        fat_g: 5,
        ingredients: [
          { kind: 'ingredient', name: 'Egg', amount: '50', unit: 'g', label_ingredient_id: id1 },
        ],
      })
      .expect(201);

    const created = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-03',
        servings: 1,
        ingredients: [{ name: 'Egg', amount: 50, unit: 'g', label_ingredient_id: id1 }],
      })
      .expect(201);

    const updated = await request(app)
      .put(`/api/log/${created.body.id}`)
      .send({
        recipe_id: recipe.id,
        servings: 1,
        ingredients: [{ name: 'Egg', amount: 100, unit: 'g', label_ingredient_id: id1 }],
      })
      .expect(200);

    expect(Number(updated.body.recipe_calories)).toBeCloseTo(140, 5);
  });

  it('POST /api/log with a mixed library+AI receipt keeps recipe_id and decrements limited uses', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (1, 'Chicken', '100g', 100, 165, 31, 0, 3.6, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Chicken prep',
        serving_size: '1 of 3 meal-prep servings',
        calories: 165,
        protein_g: 31,
        carbs_g: 0,
        fat_g: 3.6,
        recipe_kind: 'limited',
        remaining_uses: 3,
        max_uses: 3,
        ingredients: [
          { kind: 'ingredient', name: 'Chicken', amount: '100', unit: 'g', label_ingredient_id: id1 },
        ],
      })
      .expect(201);

    const logRes = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-04',
        servings: 1,
        ingredients: [
          { name: 'Chicken', amount: 100, unit: 'g', label_ingredient_id: id1 },
          { name: 'BBQ sauce', amount: 30, unit: 'g', calories: 20, protein_g: 0, carbs_g: 5, fat_g: 0, source: 'ai' },
        ],
      })
      .expect(201);

    expect(logRes.body.recipe_id).toBe(recipe.id);
    expect(logRes.body.recipe_name).toBe('Chicken prep');
    expect(Number(logRes.body.recipe_calories)).toBeCloseTo(185, 5);

    const stored = db.prepare('SELECT remaining_uses FROM recipes WHERE id = ?').get(recipe.id);
    expect(stored.remaining_uses).toBe(2);

    const row = db.prepare('SELECT ingredients_json, slot_selections_json FROM log_entries WHERE id = ?').get(logRes.body.id);
    expect(row.slot_selections_json).toBeNull();
    const ings = JSON.parse(row.ingredients_json);
    expect(ings.map(x => x.name)).toEqual(['Chicken', 'BBQ sauce']);
  });
});
