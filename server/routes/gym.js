const express = require('express');
const { uid } = require('../userId');
const { ACTIVITY_TYPES, ACTIVITY_IDS, VALID_MUSCLES, VALID_MOVEMENT } = require('../gymCatalog');

function isoDateOrNull(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function isoWeekdayFromDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

function trimStr(raw, maxLen) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function optNum(raw, { min = 0, max = 100000 } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function optInt(raw, bounds) {
  const n = optNum(raw, bounds);
  return n == null ? null : Math.round(n);
}

function parseMuscles(raw) {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function mapExercise(row) {
  if (!row) return null;
  return {
    ...row,
    secondary_muscles: parseMuscles(row.secondary_muscles),
    is_custom: Number(row.user_id) > 0,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function windowStart(window, todayIso) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = { W: 7, '2W': 14, M: 30, '3M': 90, '6M': 180 };
  if (!window || window === 'ALL' || !days[window]) return null;
  dt.setDate(dt.getDate() - (days[window] - 1));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function createGymRouter(db) {
  const router = express.Router();

  function getExercise(userId, id) {
    return db.prepare(
      `SELECT * FROM gym_exercises
        WHERE id = ? AND is_deleted = 0 AND (user_id = 0 OR user_id = ?)`
    ).get(id, userId);
  }

  function getTemplate(userId, id) {
    return db.prepare(
      `SELECT * FROM gym_templates WHERE id = ? AND user_id = ? AND is_deleted = 0`
    ).get(id, userId);
  }

  function getSession(userId, id) {
    return db.prepare(`SELECT * FROM gym_sessions WHERE id = ? AND user_id = ?`).get(id, userId);
  }

  function templateExercises(userId, templateId) {
    return db.prepare(
      `SELECT te.id, te.exercise_id, te.sort_order, te.target_sets, te.target_reps,
              te.target_weight, te.rest_sec, te.notes,
              e.name, e.primary_muscle, e.secondary_muscles, e.movement_type, e.equipment,
              e.rest_sec AS exercise_rest_sec
         FROM gym_template_exercises te
         JOIN gym_exercises e ON e.id = te.exercise_id
        WHERE te.user_id = ? AND te.template_id = ?
        ORDER BY te.sort_order, te.id`
    ).all(userId, templateId).map(r => ({
      ...r,
      secondary_muscles: parseMuscles(r.secondary_muscles),
      rest_sec: r.rest_sec ?? r.exercise_rest_sec ?? null,
    }));
  }

  function sessionSets(userId, sessionId) {
    return db.prepare(
      `SELECT st.*, e.name AS exercise_name, e.primary_muscle
         FROM gym_sets st
         JOIN gym_exercises e ON e.id = st.exercise_id
        WHERE st.user_id = ? AND st.session_id = ?
        ORDER BY st.logged_at, st.id`
    ).all(userId, sessionId);
  }

  function previousWorkingSets(userId, exerciseId, beforeDate) {
    return db.prepare(
      `SELECT st.reps, st.weight, st.weight_unit, st.set_index, sess.date
         FROM gym_sets st
         JOIN gym_sessions sess ON sess.id = st.session_id
        WHERE st.user_id = ? AND st.exercise_id = ? AND sess.date < ?
          AND COALESCE(st.is_warmup, 0) = 0
        ORDER BY sess.date DESC, st.set_index DESC, st.id DESC
        LIMIT 12`
    ).all(userId, exerciseId, beforeDate);
  }

  router.get('/activity-types', (_req, res) => {
    res.json(ACTIVITY_TYPES);
  });

  router.get('/exercises', (req, res) => {
    const userId = uid(req);
    const muscle = String(req.query.muscle || '');
    const movement = String(req.query.movement_type || '');
    const q = String(req.query.q || '').trim().toLowerCase();
    const clauses = ['is_deleted = 0', '(user_id = 0 OR user_id = ?)'];
    const params = [userId];
    if (muscle && VALID_MUSCLES.has(muscle)) {
      clauses.push('(primary_muscle = ? OR secondary_muscles LIKE ?)');
      params.push(muscle, `%"${muscle}"%`);
    }
    if (movement && VALID_MOVEMENT.has(movement)) {
      clauses.push('movement_type = ?');
      params.push(movement);
    }
    if (q) {
      clauses.push('LOWER(name) LIKE ?');
      params.push(`%${q}%`);
    }
    const rows = db.prepare(
      `SELECT * FROM gym_exercises WHERE ${clauses.join(' AND ')}
        ORDER BY CASE WHEN user_id = 0 THEN 0 ELSE 1 END, primary_muscle, name`
    ).all(...params).map(mapExercise);
    res.json(rows);
  });

  router.post('/exercises', (req, res) => {
    const userId = uid(req);
    const name = trimStr(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const primary = VALID_MUSCLES.has(req.body?.primary_muscle) ? req.body.primary_muscle : 'other';
    const movement = VALID_MOVEMENT.has(req.body?.movement_type) ? req.body.movement_type : 'other';
    const equipment = trimStr(req.body?.equipment, 40) || '';
    const rest_sec = optInt(req.body?.rest_sec, { min: 0, max: 600 });
    try {
      const r = db.prepare(
        `INSERT INTO gym_exercises (user_id, name, primary_muscle, secondary_muscles, movement_type, equipment, rest_sec)
         VALUES (?, ?, ?, '[]', ?, ?, ?)`
      ).run(userId, name, primary, movement, equipment, rest_sec);
      res.status(201).json(mapExercise(db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(r.lastInsertRowid)));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        const existing = db.prepare(
          `SELECT * FROM gym_exercises WHERE user_id = ? AND name = ? AND is_deleted = 0`
        ).get(userId, name);
        if (existing) return res.json(mapExercise(existing));
      }
      throw e;
    }
  });

  router.get('/templates', (req, res) => {
    const userId = uid(req);
    const rows = db.prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM gym_template_exercises te WHERE te.template_id = t.id) AS exercise_count
         FROM gym_templates t
        WHERE t.user_id = ? AND t.is_deleted = 0
        ORDER BY t.name`
    ).all(userId);
    res.json(rows);
  });

  router.post('/templates', (req, res) => {
    const userId = uid(req);
    const name = trimStr(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const r = db.prepare(
      `INSERT INTO gym_templates (user_id, name, split_label, notes, progression_notes)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      userId,
      name,
      trimStr(req.body?.split_label, 40),
      trimStr(req.body?.notes, 800),
      trimStr(req.body?.progression_notes, 800),
    );
    res.status(201).json(db.prepare('SELECT * FROM gym_templates WHERE id = ?').get(r.lastInsertRowid));
  });

  router.put('/templates/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const existing = getTemplate(userId, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const name = trimStr(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: 'name is required' });
    db.prepare(
      `UPDATE gym_templates SET name=?, split_label=?, notes=?, progression_notes=?
        WHERE id=? AND user_id=?`
    ).run(
      name,
      trimStr(req.body?.split_label, 40),
      trimStr(req.body?.notes, 800),
      trimStr(req.body?.progression_notes, 800),
      id,
      userId,
    );
    res.json(db.prepare('SELECT * FROM gym_templates WHERE id = ?').get(id));
  });

  router.delete('/templates/:id', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    const existing = getTemplate(userId, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE gym_templates SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(id, userId);
    res.json({ ok: true });
  });

  router.get('/templates/:id/exercises', (req, res) => {
    const userId = uid(req);
    const id = Number(req.params.id);
    if (!getTemplate(userId, id)) return res.status(404).json({ error: 'Not found' });
    res.json(templateExercises(userId, id));
  });

  router.post('/templates/:id/exercises', (req, res) => {
    const userId = uid(req);
    const templateId = Number(req.params.id);
    if (!getTemplate(userId, templateId)) return res.status(404).json({ error: 'Not found' });
    let exerciseId = optInt(req.body?.exercise_id, { min: 1, max: 1e9 });
    if (!exerciseId && req.body?.name) {
      const name = trimStr(req.body.name, 80);
      let ex = db.prepare(
        `SELECT * FROM gym_exercises WHERE is_deleted = 0 AND name = ? AND (user_id = 0 OR user_id = ?)
         ORDER BY user_id DESC LIMIT 1`
      ).get(name, userId);
      if (!ex) {
        const ins = db.prepare(
          `INSERT INTO gym_exercises (user_id, name, primary_muscle, secondary_muscles, movement_type, equipment)
           VALUES (?, ?, 'other', '[]', 'other', '')`
        ).run(userId, name);
        ex = db.prepare('SELECT * FROM gym_exercises WHERE id = ?').get(ins.lastInsertRowid);
      }
      exerciseId = ex.id;
    }
    if (!exerciseId || !getExercise(userId, exerciseId)) {
      return res.status(400).json({ error: 'exercise_id is required' });
    }
    const maxSort = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS n FROM gym_template_exercises WHERE template_id = ?'
    ).get(templateId).n;
    const r = db.prepare(
      `INSERT INTO gym_template_exercises
         (user_id, template_id, exercise_id, sort_order, target_sets, target_reps, target_weight, rest_sec, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      templateId,
      exerciseId,
      maxSort + 1,
      optInt(req.body?.target_sets, { min: 0, max: 30 }),
      optInt(req.body?.target_reps, { min: 0, max: 200 }),
      optNum(req.body?.target_weight, { min: 0, max: 2000 }),
      optInt(req.body?.rest_sec, { min: 0, max: 600 }),
      trimStr(req.body?.notes, 300),
    );
    const row = templateExercises(userId, templateId).find(x => x.id === r.lastInsertRowid);
    res.status(201).json(row);
  });

  router.put('/templates/:id/exercises/:itemId', (req, res) => {
    const userId = uid(req);
    const templateId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const row = db.prepare(
      'SELECT * FROM gym_template_exercises WHERE id = ? AND template_id = ? AND user_id = ?'
    ).get(itemId, templateId, userId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.prepare(
      `UPDATE gym_template_exercises
          SET target_sets=?, target_reps=?, target_weight=?, rest_sec=?, notes=?, sort_order=?
        WHERE id=? AND user_id=?`
    ).run(
      req.body?.target_sets === undefined ? row.target_sets : optInt(req.body.target_sets, { min: 0, max: 30 }),
      req.body?.target_reps === undefined ? row.target_reps : optInt(req.body.target_reps, { min: 0, max: 200 }),
      req.body?.target_weight === undefined ? row.target_weight : optNum(req.body.target_weight, { min: 0, max: 2000 }),
      req.body?.rest_sec === undefined ? row.rest_sec : optInt(req.body.rest_sec, { min: 0, max: 600 }),
      req.body?.notes === undefined ? row.notes : trimStr(req.body.notes, 300),
      req.body?.sort_order === undefined ? row.sort_order : optInt(req.body.sort_order, { min: 0, max: 999 }),
      itemId,
      userId,
    );
    res.json(templateExercises(userId, templateId).find(x => x.id === itemId));
  });

  router.delete('/templates/:id/exercises/:itemId', (req, res) => {
    const userId = uid(req);
    const r = db.prepare(
      'DELETE FROM gym_template_exercises WHERE id = ? AND template_id = ? AND user_id = ?'
    ).run(Number(req.params.itemId), Number(req.params.id), userId);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  router.get('/schedule', (req, res) => {
    const userId = uid(req);
    const rows = db.prepare(
      `SELECT s.*, t.name AS template_name
         FROM gym_schedule s
         LEFT JOIN gym_templates t ON t.id = s.template_id AND t.is_deleted = 0
        WHERE s.user_id = ?
        ORDER BY s.weekday`
    ).all(userId);
    const byDay = new Map(rows.map(r => [r.weekday, r]));
    const days = [];
    for (let w = 1; w <= 7; w += 1) {
      days.push(byDay.get(w) || { weekday: w, enabled: 0, template_id: null, duration_min: null, template_name: null });
    }
    res.json(days);
  });

  router.put('/schedule', (req, res) => {
    const userId = uid(req);
    const incoming = Array.isArray(req.body?.days) ? req.body.days : [];
    const upsert = db.prepare(
      `INSERT INTO gym_schedule (user_id, weekday, enabled, template_id, duration_min)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, weekday) DO UPDATE SET
         enabled = excluded.enabled,
         template_id = excluded.template_id,
         duration_min = excluded.duration_min`
    );
    const tx = db.transaction(() => {
      for (let w = 1; w <= 7; w += 1) {
        const d = incoming.find(x => Number(x.weekday) === w) || {};
        const enabled = d.enabled ? 1 : 0;
        const template_id = enabled ? optInt(d.template_id, { min: 1, max: 1e9 }) : null;
        if (template_id && !getTemplate(userId, template_id)) {
          throw Object.assign(new Error('Unknown template'), { status: 400 });
        }
        upsert.run(userId, w, enabled, template_id, optInt(d.duration_min, { min: 0, max: 480 }));
      }
    });
    try {
      tx();
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    const rows = db.prepare(
      `SELECT s.*, t.name AS template_name
         FROM gym_schedule s
         LEFT JOIN gym_templates t ON t.id = s.template_id AND t.is_deleted = 0
        WHERE s.user_id = ?
        ORDER BY s.weekday`
    ).all(userId);
    res.json(rows);
  });

  router.get('/today', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.query.date);
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    const weekday = isoWeekdayFromDate(date);
    const schedule = db.prepare(
      `SELECT s.*, t.name AS template_name
         FROM gym_schedule s
         LEFT JOIN gym_templates t ON t.id = s.template_id AND t.is_deleted = 0
        WHERE s.user_id = ? AND s.weekday = ?`
    ).get(userId, weekday) || { weekday, enabled: 0, template_id: null, duration_min: null, template_name: null };

    const session = db.prepare(
      `SELECT * FROM gym_sessions WHERE user_id = ? AND date = ? ORDER BY started_at DESC LIMIT 1`
    ).get(userId, date);

    const templateId = session?.template_id || (schedule.enabled ? schedule.template_id : null);
    const template = templateId ? getTemplate(userId, templateId) : null;
    const exercises = template ? templateExercises(userId, template.id).map(ex => ({
      ...ex,
      previous: previousWorkingSets(userId, ex.exercise_id, date),
    })) : [];

    res.json({
      date,
      weekday,
      schedule,
      session: session ? { ...session, sets: sessionSets(userId, session.id) } : null,
      template: template ? { ...template, exercises } : null,
    });
  });

  router.post('/sessions', (req, res) => {
    const userId = uid(req);
    const date = isoDateOrNull(req.body?.date);
    if (!date) return res.status(400).json({ error: 'date is required' });
    const activity_type = ACTIVITY_IDS.has(req.body?.activity_type) ? req.body.activity_type : 'strength';
    const template_id = optInt(req.body?.template_id, { min: 1, max: 1e9 });
    if (template_id && !getTemplate(userId, template_id)) {
      return res.status(400).json({ error: 'Unknown template' });
    }
    const open = db.prepare(
      `SELECT * FROM gym_sessions WHERE user_id = ? AND date = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
    ).get(userId, date);
    if (open) {
      return res.json({ ...open, sets: sessionSets(userId, open.id), reused: true });
    }
    const r = db.prepare(
      `INSERT INTO gym_sessions (user_id, date, started_at, activity_type, template_id, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, date, nowIso(), activity_type, template_id, trimStr(req.body?.notes, 500));
    const row = getSession(userId, r.lastInsertRowid);
    res.status(201).json({ ...row, sets: [] });
  });

  router.put('/sessions/:id', (req, res) => {
    const userId = uid(req);
    const session = getSession(userId, Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Not found' });
    const finish = !!req.body?.finish;
    let ended_at = session.ended_at;
    if (finish) ended_at = nowIso();
    else if (req.body?.ended_at === null) ended_at = null;
    let duration_sec = session.duration_sec;
    if (req.body?.duration_sec != null) {
      duration_sec = optInt(req.body.duration_sec, { min: 0, max: 86400 });
    } else if (finish && session.started_at) {
      duration_sec = Math.max(0, Math.round((Date.now() - Date.parse(session.started_at)) / 1000));
    }
    const activity_type = ACTIVITY_IDS.has(req.body?.activity_type) ? req.body.activity_type : session.activity_type;
    db.prepare(
      `UPDATE gym_sessions SET ended_at=?, duration_sec=?, activity_type=?, notes=? WHERE id=? AND user_id=?`
    ).run(
      ended_at,
      duration_sec,
      activity_type,
      req.body?.notes === undefined ? session.notes : trimStr(req.body.notes, 500),
      session.id,
      userId,
    );
    res.json({ ...getSession(userId, session.id), sets: sessionSets(userId, session.id) });
  });

  router.post('/sessions/:id/sets', (req, res) => {
    const userId = uid(req);
    const session = getSession(userId, Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (session.ended_at) return res.status(400).json({ error: 'Session already finished' });
    const exerciseId = optInt(req.body?.exercise_id, { min: 1, max: 1e9 });
    if (!exerciseId || !getExercise(userId, exerciseId)) {
      return res.status(400).json({ error: 'exercise_id is required' });
    }
    const nextIndex = (db.prepare(
      `SELECT COALESCE(MAX(set_index), 0) AS n FROM gym_sets WHERE session_id = ? AND exercise_id = ?`
    ).get(session.id, exerciseId).n) + 1;
    const r = db.prepare(
      `INSERT INTO gym_sets
         (user_id, session_id, exercise_id, set_index, reps, weight, weight_unit, is_warmup, is_1rm, note, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      session.id,
      exerciseId,
      nextIndex,
      optInt(req.body?.reps, { min: 0, max: 500 }),
      optNum(req.body?.weight, { min: 0, max: 2000 }),
      trimStr(req.body?.weight_unit, 8) || 'lb',
      req.body?.is_warmup ? 1 : 0,
      req.body?.is_1rm ? 1 : 0,
      trimStr(req.body?.note, 300),
      nowIso(),
    );
    if (req.body?.is_1rm && req.body?.weight) {
      db.prepare(
        `INSERT INTO gym_one_rep_maxes (user_id, exercise_id, tested, estimated, formula, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET
           tested = excluded.tested,
           updated_at = excluded.updated_at`
      ).run(userId, exerciseId, Number(req.body.weight), null, 'tested', nowIso());
    }
    const set = db.prepare('SELECT * FROM gym_sets WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(set);
  });

  router.delete('/sessions/:id/sets/:setId', (req, res) => {
    const userId = uid(req);
    const r = db.prepare(
      'DELETE FROM gym_sets WHERE id = ? AND session_id = ? AND user_id = ?'
    ).run(Number(req.params.setId), Number(req.params.id), userId);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  router.get('/progress', (req, res) => {
    const userId = uid(req);
    const exerciseId = optInt(req.query.exercise_id, { min: 1, max: 1e9 });
    if (!exerciseId) return res.status(400).json({ error: 'exercise_id is required' });
    const today = isoDateOrNull(req.query.today) || nowIso().slice(0, 10);
    const win = String(req.query.window || 'ALL');
    const from = isoDateOrNull(req.query.from) || windowStart(win, today);
    const to = isoDateOrNull(req.query.to) || (win === 'ALL' && !req.query.from ? null : today);
    const repMin = optInt(req.query.rep_min, { min: 0, max: 500 });
    const repMax = optInt(req.query.rep_max, { min: 0, max: 500 });
    const weightMin = optNum(req.query.weight_min, { min: 0, max: 2000 });
    const weightMax = optNum(req.query.weight_max, { min: 0, max: 2000 });
    const lastN = optInt(req.query.last_sessions, { min: 1, max: 50 });

    const clauses = ['st.user_id = ?', 'st.exercise_id = ?', 'COALESCE(st.is_warmup,0) = 0'];
    const params = [userId, exerciseId];
    if (from) { clauses.push('sess.date >= ?'); params.push(from); }
    if (to) { clauses.push('sess.date <= ?'); params.push(to); }
    if (repMin != null) { clauses.push('st.reps >= ?'); params.push(repMin); }
    if (repMax != null) { clauses.push('st.reps <= ?'); params.push(repMax); }
    if (weightMin != null) { clauses.push('st.weight >= ?'); params.push(weightMin); }
    if (weightMax != null) { clauses.push('st.weight <= ?'); params.push(weightMax); }

    let rows = db.prepare(
      `SELECT sess.date, sess.id AS session_id, st.reps, st.weight, st.weight_unit, st.set_index
         FROM gym_sets st
         JOIN gym_sessions sess ON sess.id = st.session_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY sess.date ASC, st.set_index ASC, st.id ASC`
    ).all(...params);

    if (lastN) {
      const sessionIds = [...new Set(rows.map(r => r.session_id))];
      const keep = new Set(sessionIds.slice(-lastN));
      rows = rows.filter(r => keep.has(r.session_id));
    }

    const byDate = new Map();
    for (const r of rows) {
      const cur = byDate.get(r.date) || { date: r.date, sets: 0, reps: 0, volume: 0, top_weight: 0, top_reps: 0 };
      cur.sets += 1;
      cur.reps += Number(r.reps) || 0;
      cur.volume += (Number(r.weight) || 0) * (Number(r.reps) || 0);
      if ((Number(r.weight) || 0) > cur.top_weight) {
        cur.top_weight = Number(r.weight) || 0;
        cur.top_reps = Number(r.reps) || 0;
      }
      byDate.set(r.date, cur);
    }
    const daily = [...byDate.values()].map(d => ({
      ...d,
      lb_per_rep: d.reps ? d.volume / d.reps : 0,
    }));

    res.json({ sets: rows, daily });
  });

  router.get('/one-rm/:exerciseId', (req, res) => {
    const userId = uid(req);
    const exerciseId = Number(req.params.exerciseId);
    const row = db.prepare(
      'SELECT * FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?'
    ).get(userId, exerciseId);
    res.json(row || { exercise_id: exerciseId, estimated: null, tested: null, formula: null });
  });

  router.put('/one-rm/:exerciseId', (req, res) => {
    const userId = uid(req);
    const exerciseId = Number(req.params.exerciseId);
    if (!getExercise(userId, exerciseId)) return res.status(404).json({ error: 'Not found' });
    db.prepare(
      `INSERT INTO gym_one_rep_maxes (user_id, exercise_id, estimated, tested, formula, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, exercise_id) DO UPDATE SET
         estimated = excluded.estimated,
         tested = excluded.tested,
         formula = excluded.formula,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      exerciseId,
      optNum(req.body?.estimated, { min: 0, max: 2000 }),
      optNum(req.body?.tested, { min: 0, max: 2000 }),
      trimStr(req.body?.formula, 24),
      nowIso(),
    );
    res.json(db.prepare(
      'SELECT * FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?'
    ).get(userId, exerciseId));
  });

  return router;
}

module.exports = { createGymRouter };
