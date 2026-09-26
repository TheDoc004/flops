const express = require('express');
const { uid } = require('../userId');
const { buildMicrosBlob, parseMicrosFlat } = require('../microNutrients');
const {
  scanSupplementLabel,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('../supplementLabelService');
const { searchSupplements, fetchSupplementLabel, DsldError } = require('../dsldService');
const { doseMultiplier, scaleValues, describeDose, parseServingText } = require('../supplementDose');
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
  'id, user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, sort_order, ' +
  'label_serving_qty, label_serving_unit, dose_qty';

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
/**
 * Label serving + your dose. The stored macros/micros describe ONE label
 * serving, so these two numbers are what turn them into real intake.
 * Defaults keep old clients working: no serving info means "1 serving, take 1".
 */
function doseFieldsFromBody(body) {
  const parsedText = parseServingText(body?.dose_text);
  const rawLabelQty = Number(body?.label_serving_qty);
  const label_serving_qty =
    Number.isFinite(rawLabelQty) && rawLabelQty > 0 ? rawLabelQty : parsedText?.qty ?? 1;
  const label_serving_unit =
    normalizeOptionalString(body?.label_serving_unit, { maxLen: 40 }) || parsedText?.unit || 'serving';
  const rawDose = Number(body?.dose_qty);
  // Taking exactly one label serving is the sane default, never zero.
  const dose_qty = Number.isFinite(rawDose) && rawDose > 0 ? rawDose : label_serving_qty;
  return { label_serving_qty, label_serving_unit, dose_qty };
}

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
  return parseMicrosFlat(micros_json);
}

/** Replace a row's raw micros_json with a parsed `micros` object for the API. */
/**
 * Shape a supplement row for the client.
 *
 * Stored macros/micros are per LABEL serving. `micros`/`calories` etc. are
 * returned already scaled to the dose actually taken, so every consumer gets
 * real intake without repeating the arithmetic; the untouched label values stay
 * available under `per_label_serving` for the UI to show both.
 *
 * @param {object} row
 * @param {number} [dayDoseQty] a specific day's amount, overriding the usual dose
 */
function shapeRow(row, dayDoseQty) {
  if (!row) return row;
  const { micros_json, ...rest } = row;
  const labelMicros = parseMicrosValues(micros_json);
  const effectiveDose =
    Number.isFinite(Number(dayDoseQty)) && Number(dayDoseQty) > 0 ? Number(dayDoseQty) : rest.dose_qty;
  const multiplier = doseMultiplier({ label_serving_qty: rest.label_serving_qty, dose_qty: effectiveDose });

  return {
    ...rest,
    dose_qty: effectiveDose ?? rest.dose_qty,
    dose_multiplier: Math.round(multiplier * 1000) / 1000,
    dose_display: describeDose(effectiveDose ?? rest.dose_qty, rest.label_serving_unit),
    label_serving_display: describeDose(rest.label_serving_qty, rest.label_serving_unit),
    calories: Math.round((Number(rest.calories) || 0) * multiplier * 100) / 100,
    protein_g: Math.round((Number(rest.protein_g) || 0) * multiplier * 100) / 100,
    carbs_g: Math.round((Number(rest.carbs_g) || 0) * multiplier * 100) / 100,
    fat_g: Math.round((Number(rest.fat_g) || 0) * multiplier * 100) / 100,
    micros: labelMicros ? scaleValues(labelMicros, multiplier) : null,
    per_label_serving: {
      calories: Number(rest.calories) || 0,
      protein_g: Number(rest.protein_g) || 0,
      carbs_g: Number(rest.carbs_g) || 0,
      fat_g: Number(rest.fat_g) || 0,
      micros: labelMicros,
    },
  };
}

function createSupplementsRouter(db) {
  const router = express.Router();

  // --- Definitions ---------------------------------------------------------

  router.get('/', (req, res) => {
    const userId = uid(req);
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
    const userId = uid(req);
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const dose_text = normalizeOptionalString(req.body?.dose_text, { maxLen: 120 });
    const calories = normalizeNumberOrZero(req.body?.calories);
    const protein_g = normalizeNumberOrZero(req.body?.protein_g);
    const carbs_g = normalizeNumberOrZero(req.body?.carbs_g);
    const fat_g = normalizeNumberOrZero(req.body?.fat_g);
    const counts_toward_macros = normalizeBoolInt(req.body?.counts_toward_macros, 0);
    const micros_json = microsJsonFromBody(req.body);
    const dose = doseFieldsFromBody(req.body);
    const nextSort =
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM supplements WHERE user_id = ?').get(userId).n;

    const r = db
      .prepare(
        `INSERT INTO supplements
           (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, sort_order,
            label_serving_qty, label_serving_unit, dose_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json, nextSort,
           dose.label_serving_qty, dose.label_serving_unit, dose.dose_qty);

    const row = db.prepare(`SELECT ${SELECT_COLS} FROM supplements WHERE id = ?`).get(r.lastInsertRowid);
    res.status(201).json(shapeRow(row));
  });

  // --- Daily checklist -----------------------------------------------------

  // Today's checklist: every active supplement + whether it's been taken on the
  // date, plus the macro totals contributed by taken items flagged to count.
  router.get('/today', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });

    const raw = db
      .prepare(
        `SELECT s.id, s.name, s.dose_text, s.calories, s.protein_g, s.carbs_g, s.fat_g,
                s.counts_toward_macros, s.micros_json, s.sort_order,
                s.label_serving_qty, s.label_serving_unit, s.dose_qty,
                sl.dose_qty AS day_dose_qty,
                CASE WHEN sl.taken = 1 THEN 1 ELSE 0 END AS taken
           FROM supplements s
           LEFT JOIN supplement_log sl
             ON sl.supplement_id = s.id AND sl.user_id = s.user_id AND sl.date = ?
          WHERE s.user_id = ? AND COALESCE(s.is_deleted, 0) = 0
          ORDER BY s.sort_order, s.name`
      )
      .all(date, userId);
    // Each row scales by that day's amount when one was recorded, else the usual dose.
    const rows = raw.map(({ day_dose_qty, ...row }) => shapeRow(row, day_dose_qty));

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
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const supplementId = Number(req.body?.supplement_id);
    if (!Number.isInteger(supplementId) || supplementId <= 0) {
      return res.status(400).json({ error: 'Invalid supplement_id' });
    }
    const taken = normalizeBoolInt(req.body?.taken, 0);
    // Optional amount for THIS day only. Omitted (or null) keeps the usual
    // dose, so the checklist stays a single tap on an ordinary day.
    const hasDose = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'dose_qty');
    const rawDose = Number(req.body?.dose_qty);
    const dayDose = hasDose && Number.isFinite(rawDose) && rawDose > 0 ? rawDose : null;

    const exists = db
      .prepare('SELECT id FROM supplements WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, 0) = 0')
      .get(supplementId, userId);
    if (!exists) return res.status(404).json({ error: 'Supplement not found' });

    db.prepare(
      `INSERT INTO supplement_log (user_id, date, supplement_id, taken, dose_qty)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date, supplement_id) DO UPDATE SET
         taken = excluded.taken,
         -- Only a supplied amount overwrites; a plain tick keeps the day's own.
         dose_qty = CASE WHEN ? THEN excluded.dose_qty ELSE supplement_log.dose_qty END`
    ).run(userId, date, supplementId, taken, dayDose, hasDose ? 1 : 0);

    res.json({ date, supplement_id: supplementId, taken, dose_qty: dayDose });
  });

  // Taken supplements that contribute anything, grouped by date, over a range.
  // History uses this to add exact supplement micros to each day's micro totals
  // AND the macros of items flagged to count, so a past day totals the same way
  // Today does. Items that carry neither are skipped, keeping the payload small.
  router.get('/range', (req, res) => {
    const userId = uid(req);
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);
    if (!start || !end) return res.status(400).json({ error: 'Invalid start/end (use YYYY-MM-DD)' });
    const [from, to] = start <= end ? [start, end] : [end, start];

    const rows = db
      .prepare(
        `SELECT sl.date AS date, s.id AS id, s.name AS name, s.micros_json AS micros_json,
                s.calories AS calories, s.protein_g AS protein_g, s.carbs_g AS carbs_g,
                s.fat_g AS fat_g, s.counts_toward_macros AS counts_toward_macros,
                s.label_serving_qty AS label_serving_qty, s.dose_qty AS dose_qty,
                sl.dose_qty AS day_dose_qty
           FROM supplement_log sl
           JOIN supplements s ON s.id = sl.supplement_id AND s.user_id = sl.user_id
          WHERE sl.user_id = ? AND sl.taken = 1 AND sl.date >= ? AND sl.date <= ?
            AND (s.micros_json IS NOT NULL OR s.counts_toward_macros = 1)
          ORDER BY sl.date, s.sort_order, s.name`
      )
      .all(userId, from, to);

    const byDate = {};
    for (const r of rows) {
      const micros = parseMicrosValues(r.micros_json);
      const countsMacros = Number(r.counts_toward_macros) === 1;
      if (!micros && !countsMacros) continue;
      // History must reflect what was actually taken that day, not the label's
      // serving — scale by that day's amount, falling back to the usual dose.
      const effectiveDose =
        Number.isFinite(Number(r.day_dose_qty)) && Number(r.day_dose_qty) > 0 ? Number(r.day_dose_qty) : r.dose_qty;
      const multiplier = doseMultiplier({ label_serving_qty: r.label_serving_qty, dose_qty: effectiveDose });
      const scaleMacro = v => Math.round((Number(v) || 0) * multiplier * 100) / 100;
      (byDate[r.date] ||= []).push({
        id: r.id,
        name: r.name,
        micros: micros ? scaleValues(micros, multiplier) : null,
        // Macros ride along already dose-scaled, exactly like /today's rows, so
        // the client only has to respect the flag — never rescale.
        counts_toward_macros: countsMacros ? 1 : 0,
        calories: scaleMacro(r.calories),
        protein_g: scaleMacro(r.protein_g),
        carbs_g: scaleMacro(r.carbs_g),
        fat_g: scaleMacro(r.fat_g),
      });
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
    const userId = uid(req);
    const id = Number(req.params.id);
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
    const dose = doseFieldsFromBody(req.body);

    db.prepare(
      `UPDATE supplements
          SET name = ?, dose_text = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
              counts_toward_macros = ?, micros_json = ?,
              label_serving_qty = ?, label_serving_unit = ?, dose_qty = ?
        WHERE id = ? AND user_id = ?`
    ).run(name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros, micros_json,
          dose.label_serving_qty, dose.label_serving_unit, dose.dose_qty, id, userId);

    const row = db.prepare(`SELECT ${SELECT_COLS} FROM supplements WHERE id = ?`).get(id);
    res.json(shapeRow(row));
  });

  // Soft delete — keeps historical supplement_log rows meaningful.
  router.delete('/:id', (req, res) => {
    const userId = uid(req);
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
