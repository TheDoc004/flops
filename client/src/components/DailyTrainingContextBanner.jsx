import { TRAINING_CONTEXT_IDS, TRAINING_CONTEXT_LABELS } from '../utils/mealTrainingReadiness';

export default function DailyTrainingContextBanner({ contextType, onChange, disabled }) {
  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Today&apos;s training
        </span>
        <select
          value={contextType}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          style={{ minWidth: 180, padding: '7px 10px', fontSize: 14, width: 'auto' }}
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
