/**
 * The conversation so far — the description, the AI's replies, and every
 * correction, as chat bubbles. Shared by the freeform estimate and the
 * matched-recipe review so both show the same history.
 */
export default function ConversationThread({ thread, loading, pendingLabel = 'Updating the estimate…' }) {
  if (!thread?.length && !loading) return null;
  return (
    <div className="ai-chat-thread">
      {(thread || []).map((m, i) => (
        <div
          key={i}
          className={`ai-chat-bubble ${m.role === 'user' ? 'ai-chat-bubble--user' : 'ai-chat-bubble--assistant'}`}
        >
          {m.text}
        </div>
      ))}
      {loading && (
        <div className="ai-chat-bubble ai-chat-bubble--pending">
          {pendingLabel}
        </div>
      )}
    </div>
  );
}
