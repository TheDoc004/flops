import { TRAINING_CONTEXT_IDS, TRAINING_CONTEXT_LABELS } from './mealTrainingReadiness';

export default function DailyTrainingContextBanner({ contextType, onChange, disabled }) {
  return (
    <div className="card" style={{ marginBottom: 12, padding: 'clamp(12px, 1.3vw, 18px) clamp(20px, 1.8vw, 26px)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'clamp(13px, 1.1vw, 15.5px)', fontWeight: 600, color: 'var(--color-text-body)' }}>
          Today&apos;s training
        </span>
        <select
          value={contextType}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="context-select"
          style={{ padding: 'clamp(7px, 0.8vw, 11px) clamp(10px, 1vw, 14px)', fontSize: 'clamp(14px, 1vw, 16px)' }}
        >
          {TRAINING_CONTEXT_IDS.map(id => (
            <option key={id} value={id}>
              {TRAINING_CONTEXT_LABELS[id]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
