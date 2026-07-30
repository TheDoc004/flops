import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSupplementsToday, setSupplementTaken } from '@shared/api/supplements';
import Reveal from '@shared/ui/Reveal';
import ManageSupplementsModal from './ManageSupplementsModal';
import { formatDose } from './doseFormat';

// Small enough to sit inside a chip, still a comfortable tap.
const STEPPER = {
  width: 26, height: 26, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff',
  color: 'var(--color-text-body)', fontSize: 15, lineHeight: 1, cursor: 'pointer', padding: 0,
  flexShrink: 0,
};

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
 * Today's supplements as a compact strip that sits directly under the macro
 * totals, rather than a full section you have to scroll to.
 *
 * Each supplement is a chip: tap it to check it off, or nudge the amount with
 * −/+ when a day differs from your usual dose. Macros from checked items that
 * count are reported up via onMacrosChange, exactly as the old card did.
 */
export default function SupplementStrip({ date, onMacrosChange }) {
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
    const optimistic = rows.map(r => (r.id === row.id ? { ...r, taken: next ? 1 : 0 } : r));
    apply(optimistic);
    try {
      await setSupplementTaken({ date, supplement_id: row.id, taken: next });
    } catch (e) {
      setError(e.message);
      apply(rows);
    }
  }

  /** Nudge today's amount only — the usual dose and other days stay put. */
  async function changeDose(row, delta) {
    const current = Number(row.dose_qty) > 0 ? Number(row.dose_qty) : 1;
    const next = Math.max(1, Math.round((current + delta) * 100) / 100);
    if (next === current) return;
    const perUnitCalories = (Number(row.calories) || 0) / (current || 1);
    const optimistic = rows.map(r =>
      r.id === row.id
        ? {
            ...r,
            dose_qty: next,
            dose_display: formatDose(next, row.label_serving_unit, row.dose_display),
            calories: Math.round(perUnitCalories * next * 100) / 100,
          }
        : r
    );
    apply(optimistic);
    try {
      await setSupplementTaken({ date, supplement_id: row.id, taken: row.taken, dose_qty: next });
      await load();
    } catch (e) {
      setError(e.message);
      apply(rows);
    }
  }

  const takenCount = rows.filter(r => r.taken).length;

  return (
    <Reveal delay={90} style={{ marginTop: 14 }}>
      <div
        style={{
          background: 'var(--color-surface)', border: '1px solid #e8e4dc', borderRadius: 12,
          padding: '10px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: rows.length ? 8 : 0 }}>
          <strong style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Supplements{rows.length > 0 ? ` · ${takenCount}/${rows.length}` : ''}
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {rows.some(r => r.micros && Object.keys(r.micros).length > 0) && (
              <Link
                to="/history#micronutrients"
                style={{ fontSize: 12.5, color: 'var(--color-link)', textDecoration: 'none', padding: '4px 6px' }}
              >
                Micros →
              </Link>
            )}
            <button
              type="button"
              onClick={() => setShowManage(true)}
              style={{ background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', fontSize: 12.5, color: 'var(--color-link)' }}
            >
              Manage
            </button>
          </div>
        </div>

        {error && <p className="error" style={{ margin: '0 0 8px', fontSize: 13 }}>{error}</p>}

        {loading ? null : rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            None yet —{' '}
            <button
              type="button"
              onClick={() => setShowManage(true)}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-link)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              add the ones you take
            </button>
            .
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rows.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 8px',
                  borderRadius: 999, border: '1px solid', minHeight: 36,
                  borderColor: r.taken ? '#a7f3d0' : '#e5e7eb',
                  background: r.taken ? '#ecfdf5' : '#fff',
                }}
              >
                <button
                  type="button"
                  onClick={() => void toggle(r)}
                  aria-pressed={!!r.taken}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none',
                    padding: 0, cursor: 'pointer', font: 'inherit',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0, width: 18, height: 18, borderRadius: 5, border: '2px solid',
                      borderColor: r.taken ? '#059669' : '#cbd5e1', background: r.taken ? '#059669' : 'transparent',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {r.taken ? '✓' : ''}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: r.taken ? 'var(--color-text-muted)' : 'var(--color-text-strong)' }}>
                    {r.name}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    {r.dose_display || ''}
                  </span>
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    type="button"
                    onClick={() => void changeDose(r, -1)}
                    disabled={(r.dose_qty ?? 1) <= 1}
                    aria-label={`Take less ${r.name}`}
                    style={STEPPER}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => void changeDose(r, 1)}
                    aria-label={`Take more ${r.name}`}
                    style={STEPPER}
                  >
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showManage && (
        <ManageSupplementsModal
          onClose={() => setShowManage(false)}
          onChanged={() => void load()}
        />
      )}
    </Reveal>
  );
}
