import { useCallback, useEffect, useMemo, useState } from 'react';
import { bulkDeleteMcpWrites, fetchRecentMcpWrites } from '@shared/api/mcpWrites';

const DISMISS_KEY = 'flops.mcpWritesBannerDismissedAt';

function isDismissed() {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const t = Number(raw);
    return Number.isFinite(t) && Date.now() - t < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Dismissible banner when MCP wrote meals in the last 24h, plus bulk-undo dialog.
 */
export default function McpWritesBanner({ onChanged }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => isDismissed());
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchRecentMcpWrites({ days: 1 });
      setData(d);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const meals = data?.meals || [];
  const count = meals.length;

  const allIds = useMemo(() => meals.map(m => m.id), [meals]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      await bulkDeleteMcpWrites({ log_entry_ids: [...selected] });
      setSelected(new Set());
      setOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !count) return null;

  return (
    <>
      <div className="mcp-writes-banner" role="status">
        <div className="mcp-writes-banner__copy">
          <strong>Assistant logged {count} meal{count === 1 ? '' : 's'}</strong>
          <span>MCP writes in the last 24h — review or undo in bulk.</span>
        </div>
        <div className="mcp-writes-banner__actions">
          <button type="button" className="btn-secondary" onClick={() => { setOpen(true); setSelected(new Set(allIds)); }}>
            Review / undo
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setDismissed(); setHidden(true); }}
          >
            Dismiss
          </button>
        </div>
      </div>

      {open && (
        <dialog className="mcp-writes-dialog" open onCancel={() => setOpen(false)}>
          <form
            method="dialog"
            onSubmit={e => {
              e.preventDefault();
              setOpen(false);
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>MCP meal writes (24h)</h2>
            <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 14 }}>
              Only assistant-created entries. Manual logs are not listed.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button type="button" className="btn-secondary" onClick={toggleAll}>
                {selected.size === allIds.length ? 'Clear selection' : 'Select all'}
              </button>
            </div>
            <ul className="mcp-writes-dialog__list">
              {meals.map(m => (
                <li key={m.id}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      style={{ marginTop: 4 }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{m.name || 'Meal'}</strong>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                        {m.date} · {Math.round(m.calories || 0)} cal
                        {m.weight_basis ? ` · ${m.weight_basis}` : ''}
                        {m.nutrition_source ? ` · ${m.nutrition_source}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
                Close
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy || !selected.size}
                onClick={() => { void handleBulkDelete(); }}
              >
                {busy ? 'Deleting…' : `Delete ${selected.size || ''} selected`}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
