import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchRoster,
  getInviteCode,
  weeklySummary,
  fetchClientLog,
  createClientSuggestion,
  fetchClientSuggestions,
} from '@shared/api/coach';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import styles from './Coach.module.css';

function formatMacros(day) {
  if (!day) return '—';
  return `${day.calories} kcal · P ${day.protein_g}g · C ${day.carbs_g}g · F ${day.fat_g}g`;
}

export default function Coach() {
  const [roster, setRoster] = useState([]);
  const [invite, setInvite] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [detail, setDetail] = useState(null);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [suggestDate, setSuggestDate] = useState(() => getLocalDateISO());
  const [suggestNote, setSuggestNote] = useState('');
  const [slotName, setSlotName] = useState('');
  const [slotProtein, setSlotProtein] = useState('');
  const [slotCal, setSlotCal] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [r, inv] = await Promise.all([fetchRoster(), getInviteCode()]);
      setRoster(r);
      setInvite(inv);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copyCode() {
    if (!invite?.invite_code) return;
    try {
      await navigator.clipboard.writeText(invite.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function toggleExpand(clientId) {
    setExpanded(e => ({ ...e, [clientId]: !e[clientId] }));
  }

  async function openDetail(client) {
    setError('');
    setSuggestMsg('');
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 13);
      const toIso = d => d.toISOString().slice(0, 10);
      const [rows, suggestions] = await Promise.all([
        fetchClientLog(client.client_user_id, toIso(start), toIso(end)),
        fetchClientSuggestions(client.client_user_id),
      ]);
      setDetail({ client, rows, suggestions });
    } catch (e) {
      setError(e.message);
    }
  }

  async function genNote(clientId) {
    setError('');
    try {
      const data = await weeklySummary(clientId);
      setNotes(n => ({ ...n, [clientId]: data.summary }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function sendSuggestion(e) {
    e.preventDefault();
    if (!detail?.client) return;
    setSuggestBusy(true);
    setSuggestMsg('');
    setError('');
    try {
      const slots = [];
      if (slotName.trim()) {
        slots.push({
          name: slotName.trim(),
          servings: 1,
          calories: slotCal === '' ? null : Number(slotCal),
          protein_g: slotProtein === '' ? null : Number(slotProtein),
        });
      }
      await createClientSuggestion(detail.client.client_user_id, {
        for_date: suggestDate,
        note: suggestNote.trim() || undefined,
        payload: { slots },
      });
      setSlotName('');
      setSlotCal('');
      setSlotProtein('');
      setSuggestNote('');
      setSuggestMsg('Suggestion sent — client can add it to their prep.');
      const suggestions = await fetchClientSuggestions(detail.client.client_user_id);
      setDetail(d => (d ? { ...d, suggestions } : d));
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggestBusy(false);
    }
  }

  const pendingHint = useMemo(
    () => (roster.length === 0 ? 'Share your invite code so a client can link you.' : null),
    [roster.length]
  );

  if (detail) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.back} onClick={() => setDetail(null)}>
          ← Roster
        </button>
        <h1 className="page-title">{detail.client.client_name}</h1>
        <p className={styles.muted}>Logs are read-only. Suggestions go to their prep list — they apply or tweak.</p>
        {error && <p className="error">{error}</p>}

        <div className={`card ${styles.inviteCard}`}>
          <h3 className="section-title">Suggest for a day</h3>
          <form onSubmit={sendSuggestion} style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13 }}>
              Date
              <input type="date" value={suggestDate} onChange={e => setSuggestDate(e.target.value)} required />
            </label>
            <label style={{ fontSize: 13 }}>
              Note (optional)
              <input value={suggestNote} onChange={e => setSuggestNote(e.target.value)} placeholder="Aim ~180g protein…" />
            </label>
            <label style={{ fontSize: 13 }}>
              Food slot
              <input value={slotName} onChange={e => setSlotName(e.target.value)} placeholder="90g cooked rice + 8oz chicken" required />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12 }}>
                kcal
                <input type="number" min="0" value={slotCal} onChange={e => setSlotCal(e.target.value)} />
              </label>
              <label style={{ fontSize: 12 }}>
                Protein g
                <input type="number" min="0" value={slotProtein} onChange={e => setSlotProtein(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="btn-primary" disabled={suggestBusy || !slotName.trim()}>
              Send suggestion
            </button>
            {suggestMsg && <p style={{ margin: 0, fontSize: 13, color: '#059669' }}>{suggestMsg}</p>}
          </form>
          {(detail.suggestions || []).length > 0 && (
            <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', fontSize: 13 }}>
              {detail.suggestions.slice(0, 8).map(s => (
                <li key={s.id} style={{ padding: '6px 0', borderTop: '1px solid #f0ebe3' }}>
                  <strong>{s.for_date}</strong> · {s.status}
                  {s.note ? ` · ${s.note}` : ''}
                  {(s.payload?.slots || []).map((sl, i) => (
                    <span key={i}> · {sl.name}</span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Meal</th>
                <th>kcal</th>
                <th>P</th>
                <th>C</th>
                <th>F</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    No meals in this range.
                  </td>
                </tr>
              ) : (
                detail.rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.recipe_name}</td>
                    <td>{Math.round((r.recipe_calories || 0) * (r.servings || 1))}</td>
                    <td>{Math.round((r.recipe_protein_g || 0) * (r.servings || 1) * 10) / 10}</td>
                    <td>{Math.round((r.recipe_carbs_g || 0) * (r.servings || 1) * 10) / 10}</td>
                    <td>{Math.round((r.recipe_fat_g || 0) * (r.servings || 1) * 10) / 10}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className="page-title" style={{ margin: 0 }}>
        Coach
      </h1>
      <p className={styles.muted}>Client roster + soft suggestions. Clients must accept your invite first.</p>

      {error && <p className="error">{error}</p>}

      <div className={`card ${styles.inviteCard}`}>
        <h3 className="section-title">Add client</h3>
        <p className={styles.muted}>Share this code face-to-face or by text. They paste it under Profile → Link a coach.</p>
        <div className={styles.codeRow}>
          <code className={styles.code}>{invite?.invite_code || '········'}</code>
          <button type="button" className="btn-primary" onClick={copyCode} disabled={!invite?.invite_code}>
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className={styles.muted}>Loading roster…</p>
      ) : (
        <div className={styles.roster}>
          {pendingHint && <p className={styles.muted}>{pendingHint}</p>}
          {roster.map(client => {
            const open = !!expanded[client.client_user_id];
            const avg = client.summary_7d?.length
              ? Math.round(
                  client.summary_7d.reduce((s, d) => s + d.calories, 0) / client.summary_7d.length
                )
              : null;
            return (
              <div key={client.client_user_id} className={`card ${styles.rowCard}`}>
                <button type="button" className={styles.rowHead} onClick={() => toggleExpand(client.client_user_id)}>
                  <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
                  <div className={styles.rowMain}>
                    <strong>{client.client_name}</strong>
                    <span className={styles.muted}>
                      Last logged: {client.last_logged || '—'}
                      {avg != null ? ` · ~${avg} kcal/day (logged days)` : ''}
                    </span>
                  </div>
                </button>
                {open && (
                  <div className={styles.expand}>
                    <h4>Last 7 days (summarized)</h4>
                    {client.summary_7d?.length ? (
                      <ul className={styles.dayList}>
                        {client.summary_7d.map(d => (
                          <li key={d.date}>
                            <span>{d.date}</span>
                            <span>{formatMacros(d)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>No nutrition logs in range (or nutrition scope off).</p>
                    )}
                    <div className={styles.actions}>
                      <button type="button" className="btn-primary" onClick={() => openDetail(client)}>
                        Open detail
                      </button>
                      <button type="button" className={styles.ghost} onClick={() => genNote(client.client_user_id)}>
                        Generate this week’s note
                      </button>
                    </div>
                    {notes[client.client_user_id] && (
                      <p className={styles.note}>{notes[client.client_user_id]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
