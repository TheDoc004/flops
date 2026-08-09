/**
 * "Anything to adjust?" — the box that keeps the conversation going. Shared by
 * the freeform estimate and the matched-recipe review so a correction works the
 * same either way (the recipe review used to have no way to refine at all).
 */
export default function FollowUpComposer({ id, value, onChange, onSend, loading, placeholder }) {
  const text = String(value || '').trim();
  return (
    <div style={{ marginTop: 16, padding: 12, border: '1px solid #e5e7eb', borderRadius: 12, background: '#f9fafb' }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-body)' }}>
        Anything to adjust?
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && text && !loading) onSend(text); }}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0, minHeight: 44 }}
        />
        <button
          type="button"
          className={loading ? 'btn-primary btn-loading' : 'btn-primary'}
          onClick={() => onSend(text)}
          disabled={loading || !text}
          style={{ minHeight: 44, fontWeight: 700, flexShrink: 0 }}
        >
          {loading ? (<><span className="btn-spinner" aria-hidden="true" />Updating…</>) : 'Send'}
        </button>
      </div>
    </div>
  );
}
