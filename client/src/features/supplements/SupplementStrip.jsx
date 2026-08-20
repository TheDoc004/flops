import { useEffect, useState } from 'react';
import { fetchSupplementsToday, setSupplementTaken } from '@shared/api/supplements';
import { sumSupplementMacros } from '@shared/utils/macros';
import Reveal from '@shared/ui/Reveal';
import ManageSupplementsModal from './ManageSupplementsModal';
import { formatDose } from './doseFormat';

// Same rule History applies to past days, so Today and Review agree.
const totalsFromRows = rows => sumSupplementMacros(rows);

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
    <Reveal style={{ marginTop: 14 }}>
      <div
        style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)', borderRadius: 14,
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: rows.length ? 10 : 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-strong)', letterSpacing: '-0.01em' }}>
            Supplements
            {rows.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {takenCount}/{rows.length}
              </span>
            )}
          </h3>
          {/* Micronutrients deliberately aren't linked from here — that's a
              Review concern. Today only answers "did I take these?" */}
          <button
            type="button"
            onClick={() => setShowManage(true)}
            style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', fontSize: 13, color: 'var(--color-link)', flexShrink: 0 }}
          >
            Manage
          </button>
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
                className={`supp-chip${r.taken ? ' is-taken' : ''}`}
              >
                <button
                  type="button"
                  className="supp-chip__toggle"
                  onClick={() => void toggle(r)}
                  aria-pressed={!!r.taken}
                >
                  <span className="supp-chip__check" aria-hidden="true">
                    {r.taken ? '✓' : ''}
                  </span>
                  {/* Name over dose: the dose is a detail, not a peer of the name. */}
                  <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: r.taken ? 'var(--color-text-muted)' : 'var(--color-text-strong)' }}>
                      {r.name}
                    </span>
                    {r.dose_display && (
                      <span style={{ fontSize: 12, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.dose_display}
                      </span>
                    )}
                  </span>
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => void changeDose(r, -1)}
                    disabled={(r.dose_qty ?? 1) <= 1}
                    aria-label={`Take less ${r.name}`}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => void changeDose(r, 1)}
                    aria-label={`Take more ${r.name}`}
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
