/**
 * Question-led feature intro — lead with the problem, not the tool name.
 * Notebook-day safe (design tokens only).
 */
export default function FeaturePrompt({ question, answer, children, style }) {
  if (!question && !answer && !children) return null;
  return (
    <div
      style={{
        margin: '0 0 16px',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        ...style,
      }}
    >
      {question && (
        <h3 style={{
          margin: '0 0 4px',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text-strong)',
          lineHeight: 1.35,
        }}
        >
          {question}
        </h3>
      )}
      {answer && (
        <p style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
        }}
        >
          {answer}
        </p>
      )}
      {children}
    </div>
  );
}
