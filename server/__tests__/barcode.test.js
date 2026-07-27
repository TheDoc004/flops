const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createBarcodeRouter } = require('../routes/barcode');
const { createLabelIngredientsRouter } = require('../routes/labelIngredients');

const PRODUCT = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero',
  serving_size: '15 g',
  serving_quantity: 15,
  serving_quantity_unit: 'g',
  nutriments: { 'energy-kcal_serving': 80.9, proteins_serving: 0.945, carbohydrates_serving: 8.63, fat_serving: 4.64 },
};

function buildApp({ fetchImpl } = {}) {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/label-ingredients', createLabelIngredientsRouter(db));
  app.use('/api/barcode', createBarcodeRouter(db, { fetchImpl }));
  return { app, db };
}

const hit = product =>
  jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 1, product }) }));
const miss = () => jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ status: 0 }) }));

describe('GET /api/barcode/:code', () => {
  it('returns normalized product data for a known barcode', async () => {
    const { app } = buildApp({ fetchImpl: hit(PRODUCT) });
    const res = await request(app).get('/api/barcode/3017620422003?user_id=0');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.name).toBe('Nutella');
    expect(res.body.basis).toBe('serving');
    expect(res.body.serving_amount).toBe(15);
    expect(res.body.existing_ingredient).toBeNull();
  });

  it('flags a barcode already saved in the library', async () => {
    const { app } = buildApp({ fetchImpl: hit(PRODUCT) });
    await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Nutella',
      serving_size_text: '15 g',
      grams_per_serving: 15,
      calories: 81,
      protein_g: 1,
      carbs_g: 8.6,
      fat_g: 4.6,
      source_type: 'barcode',
      barcode: '3017620422003',
    });
    const res = await request(app).get('/api/barcode/3017620422003?user_id=0');
    expect(res.status).toBe(200);
    expect(res.body.existing_ingredient).toMatchObject({ name: 'Nutella' });
    expect(res.body.existing_ingredient.id).toBeGreaterThan(0);
  });

  it('still answers usefully when the product is saved but unknown to Open Food Facts', async () => {
    const { app } = buildApp({ fetchImpl: miss() });
    await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Homemade Granola',
      serving_size_text: '50 g',
      grams_per_serving: 50,
      calories: 220,
      protein_g: 6,
      carbs_g: 30,
      fat_g: 8,
      barcode: '99887766',
    });
    const res = await request(app).get('/api/barcode/99887766?user_id=0');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.existing_ingredient).toMatchObject({ name: 'Homemade Granola' });
  });

  it('404s for a product nobody has on record', async () => {
    const { app } = buildApp({ fetchImpl: miss() });
    const res = await request(app).get('/api/barcode/3017620422003?user_id=0');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not in Open Food Facts/i);
  });

  it('400s on a malformed barcode without calling the product database', async () => {
    const fetchImpl = jest.fn();
    const { app } = buildApp({ fetchImpl });
    const res = await request(app).get('/api/barcode/12?user_id=0');
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('502s when the product database is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    });
    const { app } = buildApp({ fetchImpl });
    const res = await request(app).get('/api/barcode/3017620422003?user_id=0');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not reach/i);
  });
});

describe('label ingredients — barcode column', () => {
  it('saves and returns a barcode, and keeps it through an edit', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Nutella',
      serving_size_text: '15 g',
      grams_per_serving: 15,
      calories: 81,
      protein_g: 1,
      carbs_g: 8.6,
      fat_g: 4.6,
      source_type: 'barcode',
      barcode: '3017620422003',
    });
    expect(created.status).toBe(201);
    expect(created.body.barcode).toBe('3017620422003');
    expect(created.body.source_type).toBe('barcode');

    // The edit form never sends a barcode — it must survive anyway.
    const updated = await request(app).put(`/api/label-ingredients/${created.body.id}`).send({
      user_id: 0,
      name: 'Nutella (hazelnut spread)',
      serving_size_text: '15 g',
      grams_per_serving: 15,
      calories: 81,
      protein_g: 1,
      carbs_g: 8.6,
      fat_g: 4.6,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.barcode).toBe('3017620422003');
  });

  it('drops an unusable barcode instead of rejecting the save', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/label-ingredients').send({
      user_id: 0,
      name: 'Rice',
      serving_size_text: '50 g',
      grams_per_serving: 50,
      calories: 180,
      protein_g: 4,
      carbs_g: 39,
      fat_g: 0.5,
      barcode: 'not-a-barcode',
    });
    expect(res.status).toBe(201);
    expect(res.body.barcode).toBeNull();
  });
});
