import { useEffect, useState } from 'react';
import styles from '../Gym.module.css';

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export default function RestTimer({ seconds, onSkip }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left <= 0) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Rest is over', { body: 'Next set when you are ready.' });
        }
      } catch { /* notifications optional */ }
      return undefined;
    }
    const id = window.setTimeout(() => setLeft(n => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  return (
    <div className={styles.timer} role="status">
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Rest</div>
        <div className={styles.timerTime}>{fmt(left)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-secondary" onClick={() => setLeft(n => n + 15)}>+15s</button>
        <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
      </div>
    </div>
  );
}
