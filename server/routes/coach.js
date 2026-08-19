const express = require('express');
const { uid } = require('../userId');
const { randomInviteCode } = require('../authService');

function createCoachRouter(db) {
  const router = express.Router();

  function requireCoach(req, res, next) {
    if (!req.user?.is_coach) {
      return res.status(403).json({ error: 'Turn on coaching tools in Profile first.' });
    }
    next();
  }

  /** Shareable invite code for this coach. */
  router.get('/invite-code', requireCoach, (req, res) => {
    const me = uid(req);
    let user = db.prepare('SELECT invite_code, display_name FROM users WHERE id = ?').get(me);
    if (!user?.invite_code) {
      const code = randomInviteCode();
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, me);
      user = { ...user, invite_code: code };
    }
    res.json({ invite_code: user.invite_code, display_name: user.display_name });
  });

  /** Client links to a coach by pasting their invite code. */
  router.post('/link', (req, res) => {
    const me = uid(req);
    const code = String(req.body?.invite_code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Invite code required.' });
    const coach = db.prepare('SELECT * FROM users WHERE invite_code = ? AND is_coach = 1').get(code);
    if (!coach) return res.status(404).json({ error: 'No coach found for that code.' });
    if (coach.id === me) return res.status(400).json({ error: 'You cannot link to yourself.' });

    const scope_nutrition = req.body?.scope_nutrition === false || req.body?.scope_nutrition === 0 ? 0 : 1;
    const scope_training = req.body?.scope_training === false || req.body?.scope_training === 0 ? 0 : 1;
    const scope_weight = req.body?.scope_weight === false || req.body?.scope_weight === 0 ? 0 : 1;

    db.prepare(
      `INSERT INTO coach_links (coach_user_id, client_user_id, status, scope_nutrition, scope_training, scope_weight)
       VALUES (?, ?, 'active', ?, ?, ?)
       ON CONFLICT(coach_user_id, client_user_id) DO UPDATE SET
         status = 'active',
         scope_nutrition = excluded.scope_nutrition,
         scope_training = excluded.scope_training,
         scope_weight = excluded.scope_weight`
    ).run(coach.id, me, scope_nutrition, scope_training, scope_weight);

    res.status(201).json({
      coach: { id: coach.id, display_name: coach.display_name },
      scopes: { nutrition: scope_nutrition, training: scope_training, weight: scope_weight },
    });
  });

  router.get('/my-coaches', (req, res) => {
    const me = uid(req);
    const rows = db
      .prepare(
        `SELECT cl.*, u.display_name AS coach_name, u.email AS coach_email
         FROM coach_links cl
         JOIN users u ON u.id = cl.coach_user_id
         WHERE cl.client_user_id = ? AND cl.status = 'active'`
      )
      .all(me);
    res.json(rows);
  });

  router.post('/revoke', (req, res) => {
    const me = uid(req);
    const coachId = Number(req.body?.coach_user_id);
    if (!Number.isInteger(coachId) || coachId <= 0) {
      return res.status(400).json({ error: 'coach_user_id required.' });
    }
    db.prepare(
      `UPDATE coach_links SET status = 'revoked'
       WHERE coach_user_id = ? AND client_user_id = ?`
    ).run(coachId, me);
    res.json({ ok: true });
  });

  /** Roster for the signed-in coach. */
  router.get('/roster', requireCoach, (req, res) => {
    const me = uid(req);
    const links = db
      .prepare(
        `SELECT cl.*, u.display_name AS client_name, u.email AS client_email
         FROM coach_links cl
         JOIN users u ON u.id = cl.client_user_id
         WHERE cl.coach_user_id = ? AND cl.status = 'active'
         ORDER BY u.display_name COLLATE NOCASE`
      )
      .all(me);

    const out = links.map(link => {
      const clientId = link.client_user_id;
      let last_logged = null;
      let days = [];
      if (link.scope_nutrition) {
        const last = db
          .prepare(
            `SELECT date FROM log_entries WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 1`
          )
          .get(clientId);
        last_logged = last?.date || null;
        days = db
          .prepare(
            `SELECT date,
                    SUM(servings * COALESCE(recipe_calories, 0)) AS calories,
                    SUM(servings * COALESCE(recipe_protein_g, 0)) AS protein_g,
                    SUM(servings * COALESCE(recipe_carbs_g, 0)) AS carbs_g,
                    SUM(servings * COALESCE(recipe_fat_g, 0)) AS fat_g
             FROM log_entries
             WHERE user_id = ? AND date >= date('now', '-6 days')
             GROUP BY date
             ORDER BY date DESC`
          )
          .all(clientId)
          .map(d => ({
            date: d.date,
            calories: Math.round(Number(d.calories) || 0),
            protein_g: Math.round((Number(d.protein_g) || 0) * 10) / 10,
            carbs_g: Math.round((Number(d.carbs_g) || 0) * 10) / 10,
            fat_g: Math.round((Number(d.fat_g) || 0) * 10) / 10,
          }));
      }
      return {
        client_user_id: clientId,
        client_name: link.client_name || link.client_email || `Client #${clientId}`,
        scopes: {
          nutrition: !!link.scope_nutrition,
          training: !!link.scope_training,
          weight: !!link.scope_weight,
        },
        last_logged,
        summary_7d: days,
      };
    });
    res.json(out);
  });

  /** Drill-in: one client's days (read-only). */
  router.get('/clients/:clientId/log', requireCoach, (req, res) => {
    const me = uid(req);
    const clientId = Number(req.params.clientId);
    const link = db
      .prepare(
        `SELECT * FROM coach_links
         WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active'`
      )
      .get(me, clientId);
    if (!link || !link.scope_nutrition) {
      return res.status(403).json({ error: 'No nutrition access for this client.' });
    }
    const start = String(req.query.start || '').slice(0, 10);
    const end = String(req.query.end || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'start and end (YYYY-MM-DD) required.' });
    }
    const rows = db
      .prepare(
        `SELECT id, date, time_min, servings, notes, recipe_name, recipe_calories, recipe_protein_g,
                recipe_carbs_g, recipe_fat_g, recipe_fiber_g, ingredients_json
         FROM log_entries
         WHERE user_id = ? AND date >= ? AND date <= ?
         ORDER BY date, id`
      )
      .all(clientId, start, end);
    res.json(rows);
  });

  /** Optional weekly note (stub summary from last 7 days — no external AI required). */
  router.post('/clients/:clientId/weekly-summary', requireCoach, (req, res) => {
    const me = uid(req);
    const clientId = Number(req.params.clientId);
    const link = db
      .prepare(
        `SELECT * FROM coach_links
         WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active'`
      )
      .get(me, clientId);
    if (!link || !link.scope_nutrition) {
      return res.status(403).json({ error: 'No nutrition access for this client.' });
    }
    const days = db
      .prepare(
        `SELECT date,
                SUM(servings * COALESCE(recipe_calories, 0)) AS calories,
                SUM(servings * COALESCE(recipe_protein_g, 0)) AS protein_g
         FROM log_entries
         WHERE user_id = ? AND date >= date('now', '-6 days')
         GROUP BY date`
      )
      .all(clientId);
    const loggedDays = days.length;
    const avgCal = loggedDays
      ? Math.round(days.reduce((s, d) => s + Number(d.calories || 0), 0) / loggedDays)
      : 0;
    const avgP = loggedDays
      ? Math.round((days.reduce((s, d) => s + Number(d.protein_g || 0), 0) / loggedDays) * 10) / 10
      : 0;
    const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(clientId)?.display_name || 'Client';
    const note =
      loggedDays === 0
        ? `${name} has not logged any meals in the last 7 days.`
        : `${name} logged ${loggedDays} day(s) this week. Average ~${avgCal} kcal and ${avgP}g protein on logged days.`;
    res.json({ summary: note, logged_days: loggedDays, avg_calories: avgCal, avg_protein_g: avgP });
  });

  function parseSuggestionPayload(raw) {
    try {
      return typeof raw === 'string' ? JSON.parse(raw) || {} : raw || {};
    } catch {
      return {};
    }
  }

  function activeNutritionLink(coachId, clientId) {
    return db
      .prepare(
        `SELECT * FROM coach_links
         WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active' AND scope_nutrition = 1`
      )
      .get(coachId, clientId);
  }

  /** Coach creates a soft day suggestion (does not write client log_entries). */
  router.post('/clients/:clientId/suggestions', requireCoach, (req, res) => {
    const me = uid(req);
    const clientId = Number(req.params.clientId);
    if (!activeNutritionLink(me, clientId)) {
      return res.status(403).json({ error: 'No nutrition access for this client.' });
    }
    const for_date = String(req.body?.for_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(for_date)) {
      return res.status(400).json({ error: 'for_date (YYYY-MM-DD) required.' });
    }
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const slots = Array.isArray(payload.slots) ? payload.slots : [];
    if (!slots.length && !payload.freeform && !req.body?.note) {
      return res.status(400).json({ error: 'Add at least one food slot, freeform text, or a note.' });
    }
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    const r = db
      .prepare(
        `INSERT INTO coach_day_suggestions
           (coach_user_id, client_user_id, for_date, status, note, payload_json)
         VALUES (?, ?, ?, 'offered', ?, ?)`
      )
      .run(me, clientId, for_date, note, JSON.stringify(payload));
    const row = db.prepare('SELECT * FROM coach_day_suggestions WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({
      id: row.id,
      for_date: row.for_date,
      status: row.status,
      note: row.note,
      payload: parseSuggestionPayload(row.payload_json),
    });
  });

  router.get('/clients/:clientId/suggestions', requireCoach, (req, res) => {
    const me = uid(req);
    const clientId = Number(req.params.clientId);
    if (!activeNutritionLink(me, clientId)) {
      return res.status(403).json({ error: 'No nutrition access for this client.' });
    }
    const rows = db
      .prepare(
        `SELECT * FROM coach_day_suggestions
         WHERE coach_user_id = ? AND client_user_id = ?
         ORDER BY for_date DESC, id DESC LIMIT 50`
      )
      .all(me, clientId);
    res.json(
      rows.map(r => ({
        id: r.id,
        for_date: r.for_date,
        status: r.status,
        note: r.note,
        payload: parseSuggestionPayload(r.payload_json),
        created_at: r.created_at,
      }))
    );
  });

  /** Client inbox of suggestions for a date (or all open). */
  router.get('/suggestions', (req, res) => {
    const me = uid(req);
    const date = req.query.date ? String(req.query.date).slice(0, 10) : null;
    let rows;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rows = db
        .prepare(
          `SELECT s.*, u.display_name AS coach_name
           FROM coach_day_suggestions s
           JOIN users u ON u.id = s.coach_user_id
           WHERE s.client_user_id = ? AND s.for_date = ?
             AND s.status IN ('offered', 'snoozed')
           ORDER BY s.id DESC`
        )
        .all(me, date);
    } else {
      rows = db
        .prepare(
          `SELECT s.*, u.display_name AS coach_name
           FROM coach_day_suggestions s
           JOIN users u ON u.id = s.coach_user_id
           WHERE s.client_user_id = ? AND s.status IN ('offered', 'snoozed')
           ORDER BY s.for_date DESC, s.id DESC LIMIT 30`
        )
        .all(me);
    }
    res.json(
      rows.map(r => ({
        id: r.id,
        coach_user_id: r.coach_user_id,
        coach_name: r.coach_name,
        for_date: r.for_date,
        status: r.status,
        note: r.note,
        payload: parseSuggestionPayload(r.payload_json),
      }))
    );
  });

  router.patch('/suggestions/:id', (req, res) => {
    const me = uid(req);
    const id = Number(req.params.id);
    const row = db
      .prepare('SELECT * FROM coach_day_suggestions WHERE id = ? AND client_user_id = ?')
      .get(id, me);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const status = String(req.body?.status || '');
    if (!['offered', 'snoozed', 'applied', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'status must be offered|snoozed|applied|dismissed' });
    }
    let payload = parseSuggestionPayload(row.payload_json);
    if (req.body?.payload && typeof req.body.payload === 'object') {
      payload = { ...payload, ...req.body.payload };
    }
    db.prepare(
      `UPDATE coach_day_suggestions
       SET status = ?, payload_json = ?, responded_at = ?
       WHERE id = ? AND client_user_id = ?`
    ).run(status, JSON.stringify(payload), new Date().toISOString(), id, me);

    // Applying copies soft slots into the client's prep list (never coach-written logs).
    if (status === 'applied') {
      const slots = Array.isArray(payload.slots) ? payload.slots : [];
      let sort = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), 0) AS m FROM day_prep_items WHERE user_id = ? AND date = ?`
        )
        .get(me, row.for_date)?.m || 0;
      const ins = db.prepare(
        `INSERT INTO day_prep_items (user_id, date, status, sort_order, payload_json)
         VALUES (?, ?, 'planned', ?, ?)`
      );
      for (const slot of slots) {
        sort += 1;
        const name = String(slot.name || slot.label || 'Suggested food').trim();
        ins.run(
          me,
          row.for_date,
          sort,
          JSON.stringify({
            name,
            servings: slot.servings ?? 1,
            calories: slot.calories ?? null,
            protein_g: slot.protein_g ?? null,
            carbs_g: slot.carbs_g ?? null,
            fat_g: slot.fat_g ?? null,
            recipe_id: slot.recipe_id ?? null,
            from_coach_suggestion_id: id,
            notes: slot.notes || null,
          })
        );
      }
    }

    const updated = db.prepare('SELECT * FROM coach_day_suggestions WHERE id = ?').get(id);
    res.json({
      id: updated.id,
      for_date: updated.for_date,
      status: updated.status,
      note: updated.note,
      payload: parseSuggestionPayload(updated.payload_json),
    });
  });

  return router;
}

module.exports = { createCoachRouter };
