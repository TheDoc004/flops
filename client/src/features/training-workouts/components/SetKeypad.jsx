import { useEffect, useState } from 'react';
import styles from '../Gym.module.css';

export default function SetKeypad({
  title,
  initialReps = '',
  initialWeight = '',
  unit = 'lb',
  onConfirm,
  onClose,
}) {
  const [field, setField] = useState('reps');
  const [reps, setReps] = useState(String(initialReps ?? ''));
  const [weight, setWeight] = useState(String(initialWeight ?? ''));
  const [note, setNote] = useState('');
  const [warmup, setWarmup] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function push(ch) {
    const cur = field === 'reps' ? reps : weight;
    const set = field === 'reps' ? setReps : setWeight;
    if (ch === '⌫') {
      set(cur.slice(0, -1));
      return;
    }
    if (ch === '.' && cur.includes('.')) return;
    if (field === 'reps' && ch === '.') return;
    set((cur === '0' && ch !== '.') ? ch : cur + ch);
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

  return (
    <div className={styles.keypadScrim} onClick={onClose} role="presentation">
      <div
        className={styles.keypad}
        role="dialog"
        aria-label={`Log set for ${title}`}
        onClick={e => e.stopPropagation()}
      >
        <strong style={{ display: 'block', marginBottom: 12 }}>{title}</strong>
        <div className={styles.targets}>
          <button
            type="button"
            className="btn-secondary"
            data-on={field === 'reps' ? '1' : '0'}
            onClick={() => setField('reps')}
            style={{ minWidth: 88 }}
          >
            {reps || '0'} reps
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setField('weight')}
            style={{ minWidth: 110 }}
          >
            {weight || '0'} {unit}
          </button>
        </div>
        <div className={styles.padGrid}>
          {keys.map(k => (
            <button key={k} type="button" className={styles.padBtn} onClick={() => push(k)}>
              {k}
            </button>
          ))}
        </div>
        <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
          Note
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 14px', fontSize: 14 }}>
          <input type="checkbox" checked={warmup} onChange={e => setWarmup(e.target.checked)} />
          Warmup set
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm({
              reps: reps === '' ? null : Number(reps),
              weight: weight === '' ? null : Number(weight),
              note,
              is_warmup: warmup,
            })}
          >
            Log set
          </button>
        </div>
      </div>
    </div>
  );
}
