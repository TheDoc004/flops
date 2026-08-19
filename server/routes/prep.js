const express = require('express');
const { uid } = require('../userId');

function normalizeIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parsePayload(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function rowOut(r) {
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    sort_order: r.sort_order,
    payload: parsePayload(r.payload_json),
    created_at: r.created_at,
  };
}

function createPrepRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const userId = uid(req);
    const date = normalizeIsoDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
    const rows = db
      .prepare(
        `SELECT * FROM day_prep_items
         WHERE user_id = ? AND date = ? AND status != 'dismissed'
         ORDER BY sort_order ASC, id ASC`
      )
      .all(userId, date);
    res.json(rows.map(rowOut));
  });

  router.post('/', (req, res) => {
    const userId = uid(req);
    const date = normalizeIsoDate(req.body?.date);
    if (!date) return res.status(400).json({ error: 'date required' });
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const name = String(payload.name || payload.label || '').trim();
    if (!name) return res.status(400).json({ error: 'payload.name required' });
    const maxSort = db
      .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM day_prep_items WHERE user_id = ? AND date = ?`)
      .get(userId, date)?.m || 0;
    const r = db
      .prepare(
        `INSERT INTO day_prep_items (user_id, date, status, sort_order, payload_json)
         VALUES (?, ?, 'planned', ?, ?)`
      )
      .run(userId, date, maxSort + 1, JSON.stringify(payload));
    const row = db.prepare('SELECT * FROM day_prep_items WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(rowOut(row));
  });

  router.patch('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM day_prep_items WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return res.status(404).json({ error: 'Not found' });

    let status = row.status;
    let payload = parsePayload(row.payload_json);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      const s = String(req.body.status);
      if (!['planned', 'logged', 'dismissed', 'hidden'].includes(s)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      status = s;
    }
    if (req.body?.payload && typeof req.body.payload === 'object') {
      payload = { ...payload, ...req.body.payload };
    }
    db.prepare(
      `UPDATE day_prep_items SET status = ?, payload_json = ? WHERE id = ? AND user_id = ?`
    ).run(status, JSON.stringify(payload), id, userId);
    res.json(rowOut(db.prepare('SELECT * FROM day_prep_items WHERE id = ?').get(id)));
  });

  router.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    // Soft dismiss so it can be restored (toggle UX).
    const r = db
      .prepare(`UPDATE day_prep_items SET status = 'dismissed' WHERE id = ? AND user_id = ?`)
      .run(id, userId);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  /** Restore a dismissed item (toggle back on). */
  router.post('/:id/restore', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const r = db
      .prepare(
        `UPDATE day_prep_items SET status = 'planned' WHERE id = ? AND user_id = ? AND status = 'dismissed'`
      )
      .run(id, userId);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json(rowOut(db.prepare('SELECT * FROM day_prep_items WHERE id = ?').get(id)));
  });

  return router;
}

module.exports = { createPrepRouter };
