import { useEffect, useState } from 'react';
import { fetchTrainingFeedback, saveTrainingFeedback } from '@shared/api/training';

// Post-workout scales. Values are short tokens (server caps each at 16 chars);
// labels are what the user sees.
const SCALES = [
  { key: 'energy', label: 'Energy', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { key: 'stomach', label: 'Stomach', options: [['rough', 'Rough'], ['ok', 'OK'], ['good', 'Good']] },
  { key: 'performance', label: 'Performance', options: [['weak', 'Weak'], ['solid', 'Solid'], ['strong', 'Strong']] },
];

const NOTES_MAX = 140;

function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([val, label]) => {
        const active = value === val;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(active ? null : val)}
            style={{
              flex: '1 1 72px',
              minHeight: 40,
              padding: '8px 12px',
              borderRadius: 9,
              border: '1px solid',
              borderColor: active ? '#2563eb' : '#d1d5db',
              background: active ? '#2563eb' : 'white',
              color: active ? 'white' : '#374151',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Post-workout self-assessment for a single date (energy / stomach /
 * performance / notes). Upserts via PUT /api/training/feedback. This is the
 * data the future training↔nutrition bridge will read.
 */
export default function FeedbackCard({ date, onNotify }) {
  const [fb, setFb] = useState({ energy: null, stomach: null, performance: null, notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchTrainingFeedback(date)
      .then(row => {
        if (cancelled || !row) return;
        setFb({
          energy: row.energy ?? null,
          stomach: row.stomach ?? null,
          performance: row.performance ?? null,
          notes: row.notes ?? '',
        });
      })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [date]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await saveTrainingFeedback({
        date,
        energy: fb.energy,
        stomach: fb.stomach,
        performance: fb.performance,
        notes: fb.notes.trim() || null,
      });
      onNotify?.('Feedback saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 0 }}>
      <h3 style={{ margin: '0 0 4px' }}>How did this session feel?</h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
        Optional — a quick read on today so you can spot patterns over time.
      </p>

      {error && <p className="error">{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {SCALES.map(scale => (
          <div key={scale.key}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>
              {scale.label}
            </label>
            <Segmented
              value={fb[scale.key]}
              options={scale.options}
              onChange={val => setFb(prev => ({ ...prev, [scale.key]: val }))}
            />
          </div>
        ))}

        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>
            Notes
          </label>
          <textarea
            value={fb.notes}
            onChange={e => setFb(prev => ({ ...prev, notes: e.target.value.slice(0, NOTES_MAX) }))}
            placeholder="Anything worth remembering about today's workout…"
            rows={2}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'right', marginTop: 2 }}>
            {fb.notes.length}/{NOTES_MAX}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          type="button"
          className={saving ? 'btn-secondary btn-loading' : 'btn-secondary'}
          style={{ minHeight: 44, padding: '0 24px' }}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : 'Save feedback'}
        </button>
      </div>
    </div>
  );
}
