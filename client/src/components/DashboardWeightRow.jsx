import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBodyWeights, saveBodyWeight } from '../api/profile';
import { kgToWeightInputValue, parseWeightInputToKg } from '../utils/bodyUnits';

/**
 * Log or update today's body weight (same API as Profile). Compact row for Dashboard.
 */
export default function DashboardWeightRow({ today, bodyUnits, onWeightSaved }) {
  const [storedKg, setStoredKg] = useState(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchBodyWeights(today, today);
        if (cancelled) return;
        const row = rows.find(r => r.date === today);
        const kg = row?.weight_kg ?? null;
        setStoredKg(kg);
      } catch {
        if (!cancelled) {
          setStoredKg(null);
          setInput('');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => {
    setInput(storedKg != null ? kgToWeightInputValue(storedKg, bodyUnits) : '');
  }, [bodyUnits, storedKg]);

  async function handleSubmit(e) {
    e.preventDefault();
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
  const label = storedKg != null ? `Update weight (${unitLabel})` : `Weight (${unitLabel})`;

  return (
    <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}
      >
        <div style={{ flex: '1 1 140px', maxWidth: 200 }}>
          <label style={{ marginBottom: 4 }}>{label}</label>
          <input
            type="number"
            min="0.1"
            step={bodyUnits === 'us' ? '0.1' : '0.1'}
            inputMode="decimal"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={bodyUnits === 'us' ? 'e.g. 165' : 'e.g. 72.5'}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : storedKg != null ? 'Update' : 'Save'}
        </button>
        <Link to="/profile" style={{ fontSize: 13, color: '#2563eb', paddingBottom: 8 }}>
          Full history →
        </Link>
      </form>
      {error && <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</p>}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>
        One entry per day; saving again updates today.
      </p>
    </div>
  );
}
