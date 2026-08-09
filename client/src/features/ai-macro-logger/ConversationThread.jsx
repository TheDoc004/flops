/**
 * The conversation so far — the description, the AI's replies, and every
 * correction, as chat bubbles. Shared by the freeform estimate and the
 * matched-recipe review so both show the same history.
 */
export default function ConversationThread({ thread, loading, pendingLabel = 'Updating the estimate…' }) {
  if (!thread?.length && !loading) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {(thread || []).map((m, i) => (
        <div
          key={i}
          style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            padding: '10px 14px',
            borderRadius: 16,
            fontSize: 14,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            ...(m.role === 'user'
              ? { background: '#2563eb', color: '#fff', borderBottomRightRadius: 4 }
              : { background: '#f3f4f6', color: '#1f2937', borderBottomLeftRadius: 4 }),
          }}
        >
          {m.text}
        </div>
      ))}
      {loading && (
        <div style={{ alignSelf: 'flex-start', maxWidth: '85%', padding: '10px 14px', borderRadius: 16, borderBottomLeftRadius: 4, background: '#f3f4f6', color: '#6b7280', fontSize: 14, fontStyle: 'italic' }}>
          {pendingLabel}
        </div>
      )}
    </div>
  );
}
