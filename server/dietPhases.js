/**
 * Diet phases — the badges on the calendar that mark "started a cut",
 * "bulking from here", "maintenance week for recovery". The badge's NAME
 * (`label`) is free text and required; `kind` is an optional category that
 * only picks the badge color (defaults to 'other'). Shared by
 * /api/diet-phases and the MCP tools so both store and read a phase identically.
 *
 * A phase has a start_date and an OPTIONAL end_date. An open-ended phase is
 * "ongoing": it runs until the next open-ended phase starts (that is what
 * "this is when I started to bulk" means), or until today if none has. A
 * bounded phase (a maintenance week) sits on top of whatever is ongoing and
 * never cuts it short. The resolved end is returned as `effective_end_date`
 * so the calendar and the AI agree on what a day was.
 *
 * Phases are notes, not targets: nothing here changes goals or judges a day.
 * Deletes are soft (is_deleted = 1) so an MCP delete can be reverted.
 */

const PHASE_KINDS = ['cut', 'bulk', 'maintenance', 'recovery', 'other'];
const LABEL_MAX = 60;
const NOTES_MAX = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

const COLUMNS = `id, kind, label, start_date, end_date, notes, COALESCE(source, 'app') AS source,
                 COALESCE(is_deleted, 0) AS is_deleted, created_at, updated_at`;

function getPhase(db, userId, id, { includeDeleted = false } = {}) {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM diet_phases WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  if (!row) return null;
  if (row.is_deleted && !includeDeleted) return null;
  return row;
}

/**
 * Validate a create (partial = false) or a patch (partial = true).
 * Returns { error } or { fields } with only the keys that were given.
 * `end_date: null` in a patch clears the end (the phase becomes ongoing).
 */
function normalizePhaseInput(input = {}, { partial = false } = {}) {
  const fields = {};
  const has = k => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (has('kind') || !partial) {
    const kind = input.kind == null || input.kind === '' ? 'other' : String(input.kind).trim().toLowerCase();
    if (!PHASE_KINDS.includes(kind)) {
      return { error: `kind must be one of: ${PHASE_KINDS.join(', ')} (it only sets the color; put the name in label)` };
    }
    fields.kind = kind;
  }
  if (has('start_date') || !partial) {
    if (!isIsoDate(input.start_date)) return { error: 'start_date must be a real date (YYYY-MM-DD)' };
    fields.start_date = input.start_date;
  }
  if (has('end_date')) {
    if (input.end_date === null || input.end_date === '') fields.end_date = null;
    else if (!isIsoDate(input.end_date)) return { error: 'end_date must be a real date (YYYY-MM-DD) or null' };
    else fields.end_date = input.end_date;
  }
  if (has('label') || !partial) {
    const label = input.label == null ? '' : String(input.label).trim();
    if (!label) return { error: 'label (the badge name) is required, e.g. "Bulk" or "Summer cut"' };
    if (label.length > LABEL_MAX) return { error: `label must be ${LABEL_MAX} characters or fewer` };
    fields.label = label;
  }
  if (has('notes')) {
    const notes = input.notes == null ? '' : String(input.notes).trim();
    if (notes.length > NOTES_MAX) return { error: `notes must be ${NOTES_MAX} characters or fewer` };
    fields.notes = notes || null;
  }
  return { fields };
}

function checkDateOrder(start, end) {
  if (end != null && end < start) {
    return `end_date (${end}) is before start_date (${start})`;
  }
  return null;
}

function createPhase(db, userId, input, source = 'app') {
  const norm = normalizePhaseInput(input);
  if (norm.error) return { error: norm.error };
  const f = norm.fields;
  const orderErr = checkDateOrder(f.start_date, f.end_date ?? null);
  if (orderErr) return { error: orderErr };
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO diet_phases (user_id, kind, label, start_date, end_date, notes, source, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(userId, f.kind, f.label ?? null, f.start_date, f.end_date ?? null, f.notes ?? null, source, ts, ts);
  return { phase: getPhase(db, userId, info.lastInsertRowid) };
}

/** Patch a live phase. Returns { before, after } or { error, status }. */
function updatePhase(db, userId, id, input, source = 'app') {
  const before = getPhase(db, userId, id);
  if (!before) return { error: `Diet phase #${id} not found`, status: 404 };
  const norm = normalizePhaseInput(input, { partial: true });
  if (norm.error) return { error: norm.error };
  const next = { ...before, ...norm.fields };
  const orderErr = checkDateOrder(next.start_date, next.end_date);
  if (orderErr) return { error: orderErr };
  db.prepare(
    `UPDATE diet_phases
        SET kind = ?, label = ?, start_date = ?, end_date = ?, notes = ?, source = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(next.kind, next.label, next.start_date, next.end_date, next.notes, source, nowIso(), id, userId);
  return { before, after: getPhase(db, userId, id) };
}

function setPhaseDeleted(db, userId, id, deleted) {
  db.prepare(`UPDATE diet_phases SET is_deleted = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(deleted ? 1 : 0, nowIso(), id, userId);
}

/** Put a phase back exactly as a snapshot had it (used by MCP revert). */
function restorePhase(db, userId, snap) {
  db.prepare(
    `UPDATE diet_phases
        SET kind = ?, label = ?, start_date = ?, end_date = ?, notes = ?, source = ?,
            is_deleted = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    snap.kind, snap.label ?? null, snap.start_date, snap.end_date ?? null, snap.notes ?? null,
    snap.source || 'app', snap.is_deleted ? 1 : 0, nowIso(), snap.id, userId
  );
}

/**
 * Every live phase with its resolved end. `today` caps an ongoing phase
 * (an open phase can't claim days that haven't happened).
 */
function listPhasesResolved(db, userId, today) {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM diet_phases WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0
              ORDER BY start_date, id`)
    .all(userId);
  const openStarts = rows.filter(r => r.end_date == null).map(r => r.start_date);
  return rows.map(r => {
    const out = { ...r };
    delete out.is_deleted;
    if (r.end_date != null) {
      out.ongoing = false;
      out.effective_end_date = r.end_date;
      return out;
    }
    const nextOpen = openStarts.find(s => s > r.start_date);
    if (nextOpen) {
      out.ongoing = false;
      out.effective_end_date = addDaysIso(nextOpen, -1);
    } else {
      out.ongoing = true;
      // Started in the future → it covers only its own start until then.
      out.effective_end_date = today > r.start_date ? today : r.start_date;
    }
    return out;
  });
}

/** Phases that touch [start, end] (either bound may be omitted). */
function listPhases(db, userId, { start = null, end = null, today }) {
  return listPhasesResolved(db, userId, today).filter(p =>
    (end == null || p.start_date <= end) && (start == null || p.effective_end_date >= start)
  );
}

/** Phases covering one date — what the user was "in" that day. */
function phasesOnDate(db, userId, date, today) {
  return listPhases(db, userId, { start: date, end: date, today });
}

module.exports = {
  PHASE_KINDS,
  isIsoDate,
  getPhase,
  normalizePhaseInput,
  createPhase,
  updatePhase,
  setPhaseDeleted,
  restorePhase,
  listPhases,
  phasesOnDate,
};
