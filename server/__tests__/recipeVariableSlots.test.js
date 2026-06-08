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
  return { app, db };
}

describe('Recipe variable ingredient slots', () => {
  it('POST /api/log adjusts per-serving macros when a different alternative is chosen', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Brand A', '100g', 100, 100, 10, 10, 5, 'manual')`
      )
      .run();
    const r2 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Brand B', '100g', 100, 200, 20, 20, 10, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);
    const id2 = Number(r2.lastInsertRowid);

    const ingredients = [
      {
        kind: 'slot',
        slot_id: 'slot-y',
        label: 'Yogurt',
        amount: '100',
        unit: 'g',
        option_label_ingredient_ids: [id1, id2],
      },
    ];

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Yogurt bowl',
        serving_size: '1 bowl',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 5,
        ingredients,
      })
      .expect(201);

    const logDefault = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-01',
        servings: 1,
        slot_selections: { 'slot-y': id1 },
      })
      .expect(201);
    expect(Number(logDefault.body.recipe_calories)).toBeCloseTo(100, 5);

    const logB = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-02',
        servings: 1,
        slot_selections: { 'slot-y': id2 },
      })
      .expect(201);
    expect(Number(logB.body.recipe_calories)).toBeCloseTo(200, 5);
  });

  it('does not require slot_selections when a slot has only the default ingredient (no substitutes)', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Only Brand', '100g', 100, 150, 15, 15, 5, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);

    const ingredients = [
      {
        kind: 'slot',
        slot_id: 'slot-only',
        label: 'Bread',
        amount: '100',
        unit: 'g',
        option_label_ingredient_ids: [id1],
      },
    ];

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Simple sandwich',
        serving_size: '1',
        calories: 150,
        protein_g: 15,
        carbs_g: 15,
        fat_g: 5,
        ingredients,
      })
      .expect(201);

    const logRes = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-03',
        servings: 1,
      })
      .expect(201);
    expect(Number(logRes.body.recipe_calories)).toBeCloseTo(150, 5);
  });

  it('POST /api/log accepts log_slot_customizations with any library ingredient and custom grams', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Default Y', '100g', 100, 100, 10, 10, 5, 'manual')`
      )
      .run();
    const r2 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Other berry', '100g', 100, 50, 2, 8, 1, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);
    const id2 = Number(r2.lastInsertRowid);

    const ingredients = [
      {
        kind: 'slot',
        slot_id: 'slot-b',
        label: 'Berries',
        amount: '100',
        unit: 'g',
        option_label_ingredient_ids: [id1],
      },
    ];

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Berry bowl',
        serving_size: '1',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 5,
        ingredients,
      })
      .expect(201);

    const logOther = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-04',
        servings: 1,
        log_slot_customizations: {
          'slot-b': { label_ingredient_id: id2, amount: '100', unit: 'g' },
        },
      })
      .expect(201);
    expect(Number(logOther.body.recipe_calories)).toBeCloseTo(50, 5);

    const logMoreGrams = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-05',
        servings: 1,
        log_slot_customizations: {
          'slot-b': { label_ingredient_id: id1, amount: '150', unit: 'g' },
        },
      })
      .expect(201);
    expect(Number(logMoreGrams.body.recipe_calories)).toBeCloseTo(150, 5);

    const logZeroGrams = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-06',
        servings: 1,
        log_slot_customizations: {
          'slot-b': { label_ingredient_id: id1, amount: '0', unit: 'g' },
        },
      })
      .expect(201);
    expect(Number(logZeroGrams.body.recipe_calories)).toBeCloseTo(0, 5);
  });

  it('legacy Meal Builder line + meal_builder_meta resolves as a slot for log_slot_customizations', async () => {
    const { app, db } = buildApp();
    const r1 = db
      .prepare(
        `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, source_type)
         VALUES (0, 'Plain yogurt', '100g', 100, 100, 10, 10, 5, 'manual')`
      )
      .run();
    const id1 = Number(r1.lastInsertRowid);

    const ingredients = [{ kind: 'line', name: 'Plain yogurt', amount: '100 g' }];
    const meal_builder_meta = {
      source: 'meal_builder',
      lines: [
        {
          label_ingredient_id: id1,
          name: 'Plain yogurt',
          amount: 100,
          unit: 'g',
          slot_id: 'legacy-yogurt-slot',
        },
      ],
    };

    const { body: recipe } = await request(app)
      .post('/api/recipes')
      .send({
        name: 'Legacy yogurt bowl',
        serving_size: '1',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 5,
        ingredients,
        meal_builder_meta,
      })
      .expect(201);

    const logHalf = await request(app)
      .post('/api/log')
      .send({
        recipe_id: recipe.id,
        date: '2026-06-11',
        servings: 1,
        log_slot_customizations: {
          'legacy-yogurt-slot': { label_ingredient_id: id1, amount: '50', unit: 'g' },
        },
      })
      .expect(201);
    expect(Number(logHalf.body.recipe_calories)).toBeCloseTo(50, 5);
  });
});
