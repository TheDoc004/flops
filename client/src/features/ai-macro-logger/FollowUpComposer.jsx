/**
 * "Anything to adjust?" — the box that keeps the conversation going. Shared by
 * the freeform estimate and the matched-recipe review so a correction works the
 * same either way (the recipe review used to have no way to refine at all).
 */
export default function FollowUpComposer({ id, value, onChange, onSend, loading, placeholder }) {
  const text = String(value || '').trim();
  return (
    <div className="ai-followup-panel modal-subpanel">
      <label htmlFor={id} className="ai-followup-panel__label">
        Anything to adjust?
      </label>
      <div className="ai-followup-panel__row">
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && text && !loading) onSend(text); }}
          placeholder={placeholder}
        />
        <button
          type="button"
          className={loading ? 'btn-primary btn-loading' : 'btn-primary'}
          onClick={() => onSend(text)}
          disabled={loading || !text}
        >
          {loading ? (<><span className="btn-spinner" aria-hidden="true" />Updating…</>) : 'Send'}
        </button>
      </div>
    </div>
  );
}
