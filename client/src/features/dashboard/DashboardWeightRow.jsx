import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBodyWeights, saveBodyWeight } from '@shared/api/profile';
import { addDaysLocal } from '@shared/utils/dateLocal';
import { kgToWeightInputValue, parseWeightInputToKg, formatWeightKg, kgToLb } from '@shared/utils/bodyUnits';

/** How far back to look for the previous weigh-in shown as context. */
const LOOKBACK_DAYS = 90;

function shortDate(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "+0.4 lb" / "−1.2 kg" — signed, in the display unit. */
function formatDelta(kgDelta, bodyUnits) {
  const inUnit = bodyUnits === 'us' ? kgToLb(kgDelta) : kgDelta;
  if (inUnit == null) return '';
  const rounded = Math.round(inUnit * 10) / 10;
  if (Math.abs(rounded) < 0.05) return `no change`;
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded).toFixed(1)} ${bodyUnits === 'us' ? 'lb' : 'kg'}`;
}

/**
 * Today's weigh-in — a daily action, so the card is one field and one button.
 *
 * The button carries the state: it saves, then settles into a green "Weight
 * saved" that isn't asking for anything. Typing a different number turns it
 * back into a live "Update weight", which is the only way a mis-typed weight
 * gets corrected. The trend itself lives in Review; this card only shows the
 * previous weigh-in, as a sanity check against what you're typing.
 */
export default function DashboardWeightRow({ today, bodyUnits, onWeightSaved, noCard = false }) {
  const [storedKg, setStoredKg] = useState(null);
  const [previous, setPrevious] = useState(null); // { date, weight_kg } before today
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchBodyWeights(addDaysLocal(today, -LOOKBACK_DAYS), today);
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setStoredKg(list.find(r => r.date === today)?.weight_kg ?? null);
        const before = list
          .filter(r => r.date < today && r.weight_kg != null)
          .sort((a, b) => a.date.localeCompare(b.date));
        setPrevious(before.length ? before[before.length - 1] : null);
      } catch {
        if (!cancelled) {
          setStoredKg(null);
          setPrevious(null);
          setInput('');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => {
    setInput(storedKg != null ? kgToWeightInputValue(storedKg, bodyUnits) : '');
  }, [bodyUnits, storedKg]);

  const typedKg = useMemo(() => parseWeightInputToKg(input, bodyUnits), [input, bodyUnits]);

  // Saved and untouched? Then there is nothing to do — the button says so.
  // A different number in the field is what turns it back into an action.
  //
  // Compared as displayed, not in kg: storage is metric, so in lb mode the
  // value shown is a rounded conversion and comparing raw kg would read the
  // untouched field as an edit.
  const isSaved = storedKg != null;
  const changed =
    typedKg != null &&
    (storedKg == null ||
      kgToWeightInputValue(typedKg, bodyUnits) !== kgToWeightInputValue(storedKg, bodyUnits));

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving || (isSaved && !changed)) return;
    setError('');
    const kg = parseWeightInputToKg(input, bodyUnits);
    const hint = bodyUnits === 'us' ? 'pounds' : 'kilograms';
    if (kg == null) {
      setError(`Enter a valid weight in ${hint}.`);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveBodyWeight(today, kg);
      setStoredKg(saved.weight_kg);
      setInput(kgToWeightInputValue(saved.weight_kg, bodyUnits));
      onWeightSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save weight');
    } finally {
      setSaving(false);
    }
  }

  const unitLabel = bodyUnits === 'us' ? 'lb' : 'kg';
  const settled = isSaved && !changed;

  let buttonLabel = 'Save weight';
  if (saving) buttonLabel = 'Saving…';
  else if (isSaved) buttonLabel = 'Update weight';

  // One line of context under the field: what you weighed last time before
  // saving, and how today compares once you have.
  let status = null;
  if (settled && previous?.weight_kg != null) {
    status = `Logged for today · ${formatDelta(storedKg - previous.weight_kg, bodyUnits)} since ${shortDate(previous.date)}`;
  } else if (settled) {
    status = 'Logged for today · your first weigh-in';
  } else if (previous?.weight_kg != null) {
    status = `Last weigh-in ${formatWeightKg(previous.weight_kg, bodyUnits)} on ${shortDate(previous.date)}`;
  } else {
    status = 'No weigh-ins yet. This one becomes your starting point.';
  }

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Today&apos;s weight</h3>
        {/* Full history means the weight trend, which lives in Review. */}
        <Link
          to="/history#weight-trend"
          style={{ fontSize: 13, color: 'var(--color-link)', flexShrink: 0 }}
        >
          Full history
        </Link>
      </div>

      <form
        onSubmit={handleSubmit}
        className="weight-row"
      >
        <div className="weight-field">
          <input
            type="number"
            min="0.1"
            step="0.1"
            inputMode="decimal"
            aria-label={`Today's weight in ${unitLabel}`}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={bodyUnits === 'us' ? 'e.g. 165' : 'e.g. 72.5'}
          />
          <span className="weight-field-unit" aria-hidden="true">{unitLabel}</span>
        </div>

        {!settled && (
          <button
            type="submit"
            className={saving ? 'btn-primary btn-loading' : 'btn-primary'}
            disabled={saving}
          >
            {saving ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : buttonLabel}
          </button>
        )}
      </form>

      <p
        aria-live="polite"
        className={`weight-status${settled ? ' is-saved' : ''}`}
      >
        {status}
      </p>

      {error && <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</p>}
    </>
  );

  if (noCard) return inner;
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      {inner}
    </div>
  );
}
