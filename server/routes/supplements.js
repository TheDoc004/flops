const express = require('express');
const { buildMicrosBlob, MICRO_KEYS } = require('../microNutrients');
const {
  scanSupplementLabel,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('../supplementLabelService');
const { searchSupplements, fetchSupplementLabel, DsldError } = require('../dsldService');
const { estimateSupplementMicros } = require('../supplementEstimateService');

function normalizeNumberOrZero(v, { min = 0 } = {}) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return 0;
  return n;
}

function normalizeOptionalString(v, { maxLen = 120 } = {}) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeBoolInt(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  return def;
}

function isoDateOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

const SELECT_COLS =
  'id, user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, sort_order';

/**
 * Build the micros_json string to store for a supplement from a request body's
 * `micros` object, or null when none/all-zero. Supplement micros come straight
 * off the label, so they are stored at HIGH confidence (unlike AI food estimates).
 */
/**
 * Micros default to high confidence because they normally come off a real label
 * (photo scan or an NIH database match). A name-only AI estimate is the one
 * exception and says so explicitly, so it can never be mistaken for label data.
 */
function microsJsonFromBody(body) {
  const claimed = body?.micros_confidence;
  const confidence = claimed === 'medium' || claimed === 'low' ? claimed : 'high';
  const source =
    typeof body?.micros_source === 'string' && body.micros_source.trim()
      ? body.micros_source.trim().slice(0, 80)
      : confidence === 'high'
        ? 'From supplement label'
        : 'Estimated from the product name';
  const blob = buildMicrosBlob(body?.micros, { confidence, notes: source });
  return blob ? JSON.stringify(blob) : null;
}

/** Flat { key: amount } micros object parsed from a stored blob, or null. */
function parseMicrosValues(micros_json) {
  if (!micros_json) return null;
  try {
    const p = typeof micros_json === 'string' ? JSON.parse(micros_json) : micros_json;
    if (!p || typeof p !== 'object' || !p.micros || typeof p.micros !== 'object') return null;
    const out = {};
    for (const k of MICRO_KEYS) {
      const v = Number(p.micros[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Replace a row's raw micros_json with a parsed `micros` object for the API. */
function shapeRow(row) {
  if (!row) return row;
  const { micros_json, ...rest } = row;
  return { ...rest, micros: parseMicrosValues(micros_json) };
}

function createSupplementsRouter(db) {
  const router = express.Router();

  // --- Definitions ---------------------------------------------------------

  router.get('/', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const rows = db
      .prepare(
        `SELECT ${SELECT_COLS} FROM supplements
          WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0
          ORDER BY sort_order, name`
      )
      .all(userId);
    res.json(rows.map(shapeRow));
  });

  router.post('/', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const dose_text = normalizeOptionalString(req.body?.dose_text, { maxLen: 120 });
    const calories = normalizeNumberOrZero(req.body?.calories);
    const protein_g = normalizeNumberOrZero(req.body?.protein_g);
    const carbs_g = normalizeNumberOrZero(req.body?.carbs_g);
    const fat_g = normalizeNumberOrZero(req.body?.fat_g);
    const counts_toward_macros = normalizeBoolInt(req.body?.counts_toward_macros, 0);
    const micros_json = microsJsonFromBody(req.body);
    const nextSort =
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM supplements WHERE user_id = ?').get(userId).n;

    const r = db
      .prepare(
        `INSERT INTO supplements
           (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, nextSort);

    const row = db.prepare(`SELECT ${SELECT_COLS} FROM supplements WHERE id = ?`).get(r.lastInsertRowid);
    res.status(201).json(shapeRow(row));
  });

  // --- Daily checklist -----------------------------------------------------

  // Today's checklist: every active supplement + whether it's been taken on the
  // date, plus the macro totals contributed by taken items flagged to count.
  router.get('/today', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const raw = db
      .prepare(
        `SELECT s.id, s.name, s.dose_text, s.calories, s.protein_g, s.carbs_g, s.fat_g,
                s.counts_toward_macros, s.micros_json, s.sort_order,
                CASE WHEN sl.taken = 1 THEN 1 ELSE 0 END AS taken
           FROM supplements s
           LEFT JOIN supplement_log sl
             ON sl.supplement_id = s.id AND sl.user_id = s.user_id AND sl.date = ?
          WHERE s.user_id = ? AND COALESCE(s.is_deleted, 0) = 0
          ORDER BY s.sort_order, s.name`
      )
      .all(date, userId);
    const rows = raw.map(shapeRow);

    const totals = rows.reduce(
      (acc, r) => {
        if (r.taken && r.counts_toward_macros) {
          acc.calories += r.calories;
          acc.protein_g += r.protein_g;
          acc.carbs_g += r.carbs_g;
          acc.fat_g += r.fat_g;
        }
        return acc;
      },
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );

    res.json({ date, supplements: rows, totals });
  });

  // Toggle/set taken state for a supplement on a date.
  router.put('/log', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const supplementId = Number(req.body?.supplement_id);
    if (!Number.isInteger(supplementId) || supplementId <= 0) {
      return res.status(400).json({ error: 'Invalid supplement_id' });
    }
    const taken = normalizeBoolInt(req.body?.taken, 0);

    const exists = db
      .prepare('SELECT id FROM supplements WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, 0) = 0')
      .get(supplementId, userId);
    if (!exists) return res.status(404).json({ error: 'Supplement not found' });

    db.prepare(
      `INSERT INTO supplement_log (user_id, date, supplement_id, taken)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date, supplement_id) DO UPDATE SET taken = excluded.taken`
    ).run(userId, date, supplementId, taken);

    res.json({ date, supplement_id: supplementId, taken });
  });

  // Taken supplements that carry micronutrients, grouped by date, over a range.
  // History uses this to add exact supplement micros to each day's micro totals.
  // Only taken items with real micros are returned, keeping the payload small.
  router.get('/range', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    if (!Number.isInteger(userId) || userId < 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);
    if (!start || !end) return res.status(400).json({ error: 'Invalid start/end (use YYYY-MM-DD)' });
    const [from, to] = start <= end ? [start, end] : [end, start];

    const rows = db
      .prepare(
        `SELECT sl.date AS date, s.id AS id, s.name AS name, s.micros_json AS micros_json
           FROM supplement_log sl
           JOIN supplements s ON s.id = sl.supplement_id AND s.user_id = sl.user_id
          WHERE sl.user_id = ? AND sl.taken = 1 AND sl.date >= ? AND sl.date <= ?
            AND s.micros_json IS NOT NULL
          ORDER BY sl.date, s.sort_order, s.name`
      )
      .all(userId, from, to);

    const byDate = {};
    for (const r of rows) {
      const micros = parseMicrosValues(r.micros_json);
      if (!micros) continue;
      (byDate[r.date] ||= []).push({ id: r.id, name: r.name, micros });
    }
    res.json({ start: from, end: to, byDate });
  });

  // Scan a Supplement Facts photo → suggested { name, dose_text, macros, micros }.
  // The image arrives as a raw binary body (like /api/ai/transcribe) so it skips
  // the small global JSON limit. Nothing is stored — the client reviews first.
  router.post('/scan-label', express.raw({ type: 'image/*', limit: '12mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No image received.' });
    }
    const mediaType = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    const imageDataUrl = `data:${mediaType};base64,${req.body.toString('base64')}`;
    try {
      const result = await scanSupplementLabel({ imageDataUrl });
      return res.json(result);
    } catch (e) {
      if (e instanceof AiConfigError) return res.status(503).json({ error: e.message });
      if (e instanceof AiQuotaError) return res.status(402).json({ error: e.message });
      if (e instanceof AiProviderError) return res.status(502).json({ error: 'The AI service had a problem. Please try again.' });
      if (e instanceof AiResponseError) return res.status(502).json({ error: "Couldn't read the label. Try a clearer, cropped photo of the Supplement Facts panel." });
      return res.status(500).json({ error: 'Failed to scan the supplement label.' });
    }
  });

  // --- Lookup by name (no photo needed) ------------------------------------

  // Search the NIH Dietary Supplement Label Database by product/brand name.
  router.get('/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ results: [] });
    try {
      const results = await searchSupplements(q, { limit: req.query.limit });
      return res.json({ results });
    } catch (e) {
      if (e instanceof DsldError) return res.status(502).json({ error: e.message });
      return res.status(500).json({ error: 'Supplement search failed.' });
    }
  });

  // Pull one matched label and shape it exactly like a scanned one.
  router.get('/dsld/:id', async (req, res) => {
    try {
      const label = await fetchSupplementLabel(req.params.id);
      if (!label) return res.status(404).json({ error: 'That product is no longer in the database.' });
      return res.json(label);
    } catch (e) {
      if (e instanceof DsldError) return res.status(502).json({ error: e.message });
      return res.status(500).json({ error: 'Failed to load that supplement.' });
    }
  });

  // Fallback for products the database doesn't carry: estimate from the name.
  // Always an estimate — capped below label confidence by the service.
  router.post('/estimate', async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Enter a supplement name.' });
    try {
      const result = await estimateSupplementMicros(name);
      return res.json(result);
    } catch (e) {
      if (e instanceof AiConfigError) return res.status(503).json({ error: e.message });
      if (e instanceof AiQuotaError) return res.status(402).json({ error: e.message });
      if (e instanceof AiProviderError) return res.status(502).json({ error: 'The AI service had a problem. Please try again.' });
      if (e instanceof AiResponseError) return res.status(502).json({ error: "Couldn't estimate that supplement. Try a more specific name." });
      return res.status(500).json({ error: 'Failed to estimate that supplement.' });
    }
  });

  // --- Definitions: update / delete ----------------------------------------
  // Declared AFTER the literal /today and /log routes so Express doesn't match
  // those paths as :id.
  router.put('/:id', (req, res) => {
    const userId = Number(req.body?.user_id ?? 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 0) return res.status(400).json({ error: 'Invalid user_id' });
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT id FROM supplements WHERE id = ? AND user_id = ?').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const dose_text = normalizeOptionalString(req.body?.dose_text, { maxLen: 120 });
    const calories = normalizeNumberOrZero(req.body?.calories);
    const protein_g = normalizeNumberOrZero(req.body?.protein_g);
    const carbs_g = normalizeNumberOrZero(req.body?.carbs_g);
    const fat_g = normalizeNumberOrZero(req.body?.fat_g);
    const counts_toward_macros = normalizeBoolInt(req.body?.counts_toward_macros, 0);
    const micros_json = microsJsonFromBody(req.body);

    db.prepare(
      `UPDATE supplements
          SET name = ?, dose_text = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
              counts_toward_macros = ?, micros_json = ?
        WHERE id = ? AND user_id = ?`
    ).run(name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, id, userId);

    const row = db.prepare(`SELECT ${SELECT_COLS} FROM supplements WHERE id = ?`).get(id);
    res.json(shapeRow(row));
  });

  // Soft delete — keeps historical supplement_log rows meaningful.
  router.delete('/:id', (req, res) => {
    const userId = Number(req.query.user_id ?? 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const r = db
      .prepare('UPDATE supplements SET is_deleted = 1 WHERE id = ? AND user_id = ?')
      .run(id, userId);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  return router;
}

module.exports = { createSupplementsRouter };
