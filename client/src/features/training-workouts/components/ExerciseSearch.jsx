import { useMemo, useState } from 'react';

export default function ExerciseSearch({ library, onPick, placeholder = 'Search exercises' }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = n
      ? library.filter(e => e.name.toLowerCase().includes(n))
      : library;
    return list.slice(0, 12);
  }, [library, q]);

  return (
    <div>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {q.trim() && (
        <div style={{ marginTop: 6, border: '1px solid var(--color-surface-border)', borderRadius: 8, overflow: 'hidden' }}>
          {hits.map(e => (
            <button
              key={e.id}
              type="button"
              onClick={() => { onPick(e); setQ(''); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                minHeight: 44,
                border: 'none',
                background: 'var(--color-surface)',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {e.name}
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-faint)' }}>{e.primary_muscle}</span>
            </button>
          ))}
          {hits.length === 0 && (
            <button
              type="button"
              onClick={() => { onPick({ name: q.trim() }); setQ(''); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                minHeight: 44, border: 'none', background: 'var(--color-surface)', cursor: 'pointer', font: 'inherit',
              }}
            >
              Add “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
