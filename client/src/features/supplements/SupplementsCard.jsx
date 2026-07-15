import { useEffect, useState } from 'react';
import { fetchSupplementsToday, setSupplementTaken } from '@shared/api/supplements';
import Reveal from '@shared/ui/Reveal';
import ManageSupplementsModal from './ManageSupplementsModal';

function totalsFromRows(rows) {
  return rows.reduce(
    (acc, r) => {
      if (r.taken && r.counts_toward_macros) {
        acc.calories += r.calories;
        acc.protein_g += r.protein_g;
        acc.carbs_g += r.carbs_g;
        acc.fat_g += r.fat_g;
      }
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/**
 * Dashboard "Supplements today" card: a daily checklist of the user's
 * supplements. Checking one that is flagged counts_toward_macros feeds its
 * macros into the day's totals (reported up via onMacrosChange).
 */
export default function SupplementsCard({ date, onMacrosChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showManage, setShowManage] = useState(false);

  function apply(newRows) {
    setRows(newRows);
    onMacrosChange?.(totalsFromRows(newRows));
  }

  async function load() {
    try {
      const data = await fetchSupplementsToday(date);
      apply(data.supplements || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchSupplementsToday(date)
      .then(data => {
        if (cancelled) return;
        setRows(data.supplements || []);
        onMacrosChange?.(totalsFromRows(data.supplements || []));
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // onMacrosChange intentionally omitted — parent passes a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function toggle(row) {
    const next = !row.taken;
    // Optimistic: update immediately, roll back on failure.
    const optimistic = rows.map(r => (r.id === row.id ? { ...r, taken: next ? 1 : 0 } : r));
    apply(optimistic);
    try {
      await setSupplementTaken({ date, supplement_id: row.id, taken: next });
    } catch (e) {
      setError(e.message);
      apply(rows); // roll back
    }
  }

  const takenCount = rows.filter(r => r.taken).length;

  return (
    <Reveal delay={90} style={{ marginTop: 'clamp(28px, 3vw, 40px)', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'clamp(14px, 1.4vw, 18px)', gap: 8 }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 'clamp(28px, 2.6vw, 34px)', fontWeight: 400, color: 'var(--color-primary-ink)',
            fontFamily: "'DM Serif Display', Georgia, serif", letterSpacing: '-0.01em',
          }}>
            Supplements
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 'clamp(13px, 1vw, 14.5px)', color: 'var(--color-text-muted)' }}>
            {rows.length === 0 ? 'None added yet' : `${takenCount} of ${rows.length} taken today`}
          </p>
        </div>
        <button type="button" className="btn-secondary" style={{ minHeight: 40, padding: '6px 16px' }} onClick={() => setShowManage(true)}>
          Manage
        </button>
      </div>

      {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

      {loading ? null : rows.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, border: '1px dashed #c4b5fd', padding: 'clamp(24px, 2.4vw, 32px) 16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 'clamp(14px, 1vw, 15.5px)' }}>
            Add the supplements you take to check them off each day.
          </p>
          <button type="button" className="btn-primary" onClick={() => setShowManage(true)}>Add supplements</button>
        </div>
      ) : (
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, border: '1px solid #e8e4dc', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          {rows.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void toggle(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '12px 16px', minHeight: 52, cursor: 'pointer', background: 'transparent', border: 'none',
                borderBottom: idx < rows.length - 1 ? '1px solid #f0ede8' : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0, width: 24, height: 24, borderRadius: 7, border: '2px solid',
                  borderColor: r.taken ? '#059669' : '#cbd5e1', background: r.taken ? '#059669' : 'transparent',
                  color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700,
                }}
              >
                {r.taken ? '✓' : ''}
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: r.taken ? 'var(--color-text-muted)' : 'var(--color-text-strong)' }}>
                  {r.name}
                </span>
                {r.dose_text && (
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-faint)', marginLeft: 8 }}>{r.dose_text}</span>
                )}
              </span>
              {r.counts_toward_macros > 0 && r.calories > 0 && (
                <span style={{ flexShrink: 0, fontSize: 12.5, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(r.calories)} cal
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {showManage && (
        <ManageSupplementsModal
          onClose={() => setShowManage(false)}
          onChanged={() => void load()}
        />
      )}
    </Reveal>
  );
}
