function lightStyle(light) {
  if (light === 'green') return { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' };
  if (light === 'yellow') return { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' };
  return { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' };
}

function LightPill({ label, light }) {
  const s = lightStyle(light);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      <span aria-hidden>{light === 'green' ? '●' : light === 'yellow' ? '●' : '●'}</span>
      {label}: {light === 'green' ? 'Green' : light === 'yellow' ? 'Yellow' : 'Red'}
    </span>
  );
}

/** @param {{ result: object, mealLabel?: string, onDismiss?: () => void }} props */
export default function MealFuelReadinessCard({ result, mealLabel, onDismiss }) {
  if (!result || result.isRest) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #2563eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 6, fontSize: 16 }}>Fuel check — {result.contextLabel}</h3>
          {mealLabel && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
              Meal: <strong style={{ color: '#111827' }}>{mealLabel}</strong>
            </p>
          )}
        </div>
        {onDismiss && (
          <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      {result.bestWindow && (
        <p style={{ margin: '12px 0 8px', fontSize: 14 }}>
          <strong>Best training window:</strong> {result.bestWindow.label}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {result.windows.map(w => (
          <LightPill key={w.id} label={w.label} light={w.light} />
        ))}
      </div>

      {result.summary && (
        <p style={{ margin: '0 0 6px', fontSize: 13, color: '#374151' }}>{result.summary}</p>
      )}
      {result.note && (
        <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280' }}>{result.note}</p>
      )}
      {result.suggestion && (
        <p style={{ margin: 0, fontSize: 13, color: '#1e40af' }}>
          <strong>Suggestion:</strong> {result.suggestion}
        </p>
      )}
    </div>
  );
}
