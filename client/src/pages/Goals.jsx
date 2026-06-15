import { useEffect, useState } from 'react';
import { fetchGoals, saveGoals } from '@shared/api/goals';
import {
  gramsToInputValue,
  parseMacroInputToGrams,
  macroLabelSuffix,
} from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { getLocalDateISO } from '@shared/utils/dateLocal';

const FIELD_META = [
  { key: 'calories', label: 'Calories', isMacro: false, step: '1', inputMode: 'numeric' },
  { key: 'fat_g', label: 'Fat', isMacro: true },
  { key: 'carbs_g', label: 'Carbs', isMacro: true },
  { key: 'protein_g', label: 'Protein', isMacro: true },
];

function emptyRow(g) {
  return {
    weekday: g.weekday,
    label: g.label,
    calories_min: g.calories_min ?? '',
    calories_max: g.calories_max ?? '',
    protein_g_min: g.protein_g_min ?? '',
    protein_g_max: g.protein_g_max ?? '',
    carbs_g_min: g.carbs_g_min ?? '',
    carbs_g_max: g.carbs_g_max ?? '',
    fat_g_min: g.fat_g_min ?? '',
    fat_g_max: g.fat_g_max ?? '',
  };
}

function parseNumberOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizePairForPayload(row, key) {
  let min = parseNumberOrNull(row[`${key}_min`]);
  let max = parseNumberOrNull(row[`${key}_max`]);
  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;
  if (min != null && max != null && min > max) {
    throw new Error(`${row.label}: ${key.replace('_g', '')} min cannot be greater than max.`);
  }
  return { min, max };
}

function toPayloadRow(row) {
  const out = { weekday: row.weekday };
  for (const field of FIELD_META) {
    const pair = normalizePairForPayload(row, field.key);
    out[`${field.key}_min`] = pair.min;
    out[`${field.key}_max`] = pair.max;
  }
  return out;
}

export default function Goals() {
  const { macroUnits } = useMacroUnits();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const today = getLocalDateISO();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchGoals({ date: today });
        if (!data?.goals) throw new Error('Invalid response');
        if (!cancelled) setRows(data.goals.map(emptyRow));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  function setField(weekday, field, value) {
    setRows(prev => prev.map(r => (r.weekday === weekday ? { ...r, [field]: value } : r)));
    setSaved(false);
  }

  function setMacroField(weekday, field, raw) {
    const g = parseMacroInputToGrams(raw, macroUnits);
    setField(weekday, field, g === null ? '' : g);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaveError('');
    setSaved(false);
    try {
      const data = await saveGoals({
        user_id: 0,
        effective_start_date: today,
        goals: rows.map(toPayloadRow),
      });
      if (data?.goals) setRows(data.goals.map(emptyRow));
      setSaved(true);
    } catch (err) {
      setSaveError(err.message);
    }
  }

  const macroSuffix = macroLabelSuffix(macroUnits);
  const macroStep = macroUnits === 'us' ? '0.01' : '0.1';

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)' }}>Loading goals…</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>Weekly nutrition goals</h1>
      <p className="page-subtitle">
        Set a min/max range per day — same value on both sides means an exact target.
        Changes apply from <strong>{today}</strong> forward; past days are unaffected.
        Macros are stored in grams; display follows your unit choice in Profile.
      </p>

      <form onSubmit={handleSave}>
        <div className="card goals-table-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '8px 12px 12px 0' }}>Day</th>
                <th style={{ padding: '8px 8px 12px' }}>Calories</th>
                <th style={{ padding: '8px 8px 12px' }}>Fat {macroSuffix}</th>
                <th style={{ padding: '8px 8px 12px' }}>Carbs {macroSuffix}</th>
                <th style={{ padding: '8px 0 12px 8px' }}>Protein {macroSuffix}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.weekday} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '12px 12px 12px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.label}</td>
                  {FIELD_META.map((field, idx) => {
                    const minKey = `${field.key}_min`;
                    const maxKey = `${field.key}_max`;
                    const pad = idx === FIELD_META.length - 1 ? '8px 0 8px 8px' : '8px';
                    return (
                      <td key={field.key} style={{ padding: pad, minWidth: 170 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input
                            type="number"
                            min="0"
                            step={field.isMacro ? macroStep : field.step}
                            inputMode={field.isMacro ? 'decimal' : field.inputMode}
                            value={field.isMacro ? gramsToInputValue(row[minKey], macroUnits) : row[minKey]}
                            onChange={e => (
                              field.isMacro
                                ? setMacroField(row.weekday, minKey, e.target.value)
                                : setField(row.weekday, minKey, e.target.value)
                            )}
                            placeholder="min"
                          />
                          <input
                            type="number"
                            min="0"
                            step={field.isMacro ? macroStep : field.step}
                            inputMode={field.isMacro ? 'decimal' : field.inputMode}
                            value={field.isMacro ? gramsToInputValue(row[maxKey], macroUnits) : row[maxKey]}
                            onChange={e => (
                              field.isMacro
                                ? setMacroField(row.weekday, maxKey, e.target.value)
                                : setField(row.weekday, maxKey, e.target.value)
                            )}
                            placeholder="max"
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--color-text-faint)' }}>
                          <span>min</span>
                          <span>max</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile-only: vertical day cards (same state/handlers as the table) */}
        <div className="card goals-cards">
          {rows.map(row => (
            <div key={row.weekday} className="goals-day-card">
              <h3 className="goals-day-title">{row.label}</h3>
              {FIELD_META.map(field => {
                const minKey = `${field.key}_min`;
                const maxKey = `${field.key}_max`;
                return (
                  <div key={field.key} className="goals-macro">
                    <label className="goals-macro-label">
                      {field.label}{field.isMacro ? ` ${macroSuffix}` : ''}
                    </label>
                    <div className="goals-minmax">
                      <input
                        type="number"
                        min="0"
                        step={field.isMacro ? macroStep : field.step}
                        inputMode={field.isMacro ? 'decimal' : field.inputMode}
                        value={field.isMacro ? gramsToInputValue(row[minKey], macroUnits) : row[minKey]}
                        onChange={e => (
                          field.isMacro
                            ? setMacroField(row.weekday, minKey, e.target.value)
                            : setField(row.weekday, minKey, e.target.value)
                        )}
                        placeholder="min"
                        aria-label={`${row.label} ${field.label} minimum`}
                      />
                      <input
                        type="number"
                        min="0"
                        step={field.isMacro ? macroStep : field.step}
                        inputMode={field.isMacro ? 'decimal' : field.inputMode}
                        value={field.isMacro ? gramsToInputValue(row[maxKey], macroUnits) : row[maxKey]}
                        onChange={e => (
                          field.isMacro
                            ? setMacroField(row.weekday, maxKey, e.target.value)
                            : setField(row.weekday, maxKey, e.target.value)
                        )}
                        placeholder="max"
                        aria-label={`${row.label} ${field.label} maximum`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {saveError && <p className="error" style={{ marginTop: 12 }}>{saveError}</p>}
        {saved && <p style={{ marginTop: 12, color: 'var(--color-success)', fontSize: 14 }}>Goals saved from today forward.</p>}

        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn-primary">Save goals</button>
        </div>
      </form>
    </div>
  );
}
