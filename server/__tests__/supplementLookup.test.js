const request = require('supertest');
const express = require('express');
const { createDb } = require('../db');
const { createAuthMiddleware } = require('../middleware/auth');
const { createSupplementsRouter } = require('../routes/supplements');

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  const { attachUser, requireAuth } = createAuthMiddleware(db);
  app.use(express.json());
  app.use(attachUser);
  app.use(requireAuth);
  app.use('/api/supplements', createSupplementsRouter(db));
  return { app, db };
}

const mockFetch = payload => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
};

afterEach(() => {
  delete global.fetch;
});

describe('GET /api/supplements/search', () => {
  it('returns shaped results from the label database', async () => {
    mockFetch({
      hits: [{ _id: '17144', _source: { fullName: 'Centrum Men Under 50', brandName: 'Centrum', offMarket: 0, entryDate: '2013-01-25' } }],
    });
    const { app } = buildApp();
    const res = await request(app).get('/api/supplements/search?q=centrum');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ id: '17144', brand: 'Centrum' });
  });

  it('answers an empty list for a too-short query without calling out', async () => {
    global.fetch = jest.fn();
    const { app } = buildApp();
    const res = await request(app).get('/api/supplements/search?q=c');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('502s when the database is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    const { app } = buildApp();
    const res = await request(app).get('/api/supplements/search?q=centrum');
    expect(res.status).toBe(502);
  });
});

describe('GET /api/supplements/dsld/:id', () => {
  it('returns a label shaped like a scanned one', async () => {
    mockFetch({
      fullName: 'Centrum Men Under 50',
      brandName: 'Centrum',
      servingSizes: [{ minQuantity: 1, unit: 'Tablet(s)' }],
      ingredientRows: [
        { ingredientGroup: 'Vitamin D', name: 'Vitamin D', quantity: [{ quantity: 600, unit: 'IU' }] },
      ],
    });
    const { app } = buildApp();
    const res = await request(app).get('/api/supplements/dsld/17144');
    expect(res.status).toBe(200);
    expect(res.body.micros).toEqual({ vitamin_d_mcg: 15 });
    expect(res.body.confidence).toBe('high');
    expect(res.body.dose_text).toBe('1 Tablet');
  });

  it('404s for an id that is gone', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const { app } = buildApp();
    const res = await request(app).get('/api/supplements/dsld/999999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/supplements/estimate', () => {
  it('rejects an empty name before spending an AI call', async () => {
    global.fetch = jest.fn();
    const { app } = buildApp();
    const res = await request(app).post('/api/supplements/estimate').send({ name: ' ' });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('stored micro confidence', () => {
  const micros = { vitamin_d_mcg: 50 };

  it('defaults to high — micros normally come off a real label', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/supplements').send({ name: 'Vitamin D', micros });
    expect(res.status).toBe(201);
    const blob = JSON.parse(db.prepare('SELECT micros_json FROM supplements WHERE id = ?').get(res.body.id).micros_json);
    expect(blob.confidence).toBe('high');
    expect(blob.micros).toEqual({ vitamin_d_mcg: 50 });
  });

  it('stores an AI estimate at medium confidence, never label confidence', async () => {
    const { app, db } = buildApp();
    const res = await request(app)
      .post('/api/supplements')
      .send({ name: 'Obscure Brand D3', micros, micros_confidence: 'medium', micros_source: 'Estimated from the product name' });
    expect(res.status).toBe(201);
    const row = db.prepare('SELECT micros_json FROM supplements WHERE id = ?').get(res.body.id);
    const blob = JSON.parse(row.micros_json);
    expect(blob.confidence).toBe('medium');
    expect(blob.notes).toMatch(/Estimated from the product name/);
  });

  it('ignores a bogus confidence value and falls back to label confidence', async () => {
    const { app, db } = buildApp();
    const res = await request(app).post('/api/supplements').send({ name: 'X', micros, micros_confidence: 'super-high' });
    const blob = JSON.parse(db.prepare('SELECT micros_json FROM supplements WHERE id = ?').get(res.body.id).micros_json);
    expect(blob.confidence).toBe('high');
    expect(blob.notes).toBe('From supplement label');
  });
});
