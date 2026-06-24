import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { estimateMacros } from '@shared/api/ai';
import { createCustomLog } from '@shared/api/log';
import { createRecipe } from '@shared/api/recipes';
import { getLocalDateISO } from '@shared/utils/dateLocal';

const PLACEHOLDER =
  'Example: 155g cooked turkey, 250g sweet potato, 20 calories BBQ sauce…';

const STATE_LABELS = { raw: 'raw', cooked: 'cooked', unknown: '', not_applicable: '' };

const CONFIDENCE_META = {
  high: { label: 'High confidence', bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46' },
  medium: { label: 'Medium confidence — review carefully', bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
  low: { label: 'Low confidence — review carefully before logging', bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' },
};

const n = v => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

/** Defensive client-side normalization so a malformed response can't crash the UI. */
function normalizeEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(i => ({
    name: typeof i?.name === 'string' && i.name.trim() ? i.name.trim() : 'Item',
    quantity: Number.isFinite(Number(i?.quantity)) ? Number(i.quantity) : 0,
    unit: typeof i?.unit === 'string' ? i.unit : '',
    state: ['raw', 'cooked', 'unknown', 'not_applicable'].includes(i?.state) ? i.state : 'unknown',
    calories: n(i?.calories),
    protein: n(i?.protein),
    carbs: n(i?.carbs),
    fat: n(i?.fat),
    notes: typeof i?.notes === 'string' ? i.notes : '',
  }));
  return {
    mealName: typeof raw.mealName === 'string' && raw.mealName.trim() ? raw.mealName.trim() : 'Meal',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
    ingredients,
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : []).filter(x => typeof x === 'string'),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).filter(x => typeof x === 'string'),
  };
}

export default function AiMacroLogger() {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [correction, setCorrection] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [busy, setBusy] = useState('');

  // Totals are always the live sum of the (editable) ingredient macros.
  const totals = useMemo(() => {
    const ings = estimate?.ingredients || [];
    return ings.reduce(
      (acc, x) => ({
        calories: acc.calories + n(x.calories),
        protein: acc.protein + n(x.protein),
        carbs: acc.carbs + n(x.carbs),
        fat: acc.fat + n(x.fat),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [estimate]);

  async function runEstimate(corr) {
    const desc = description.trim();
    if (!desc) {
      setError('Describe a meal first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const raw = await estimateMacros({ description: desc, correction: corr || undefined });
      const normalized = normalizeEstimate(raw);
      if (!normalized) throw new Error('The estimate came back in an unexpected format. Please try again.');
      setEstimate(normalized);
      setReviseOpen(false);
      setCorrection('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function updateMacro(idx, field, value) {
    setEstimate(prev => {
      if (!prev) return prev;
      const ingredients = prev.ingredients.map((ing, i) =>
        i === idx ? { ...ing, [field]: value === '' ? 0 : Number(value) } : ing
      );
      return { ...prev, ingredients };
    });
  }

  function clearAll() {
    setEstimate(null);
    setDescription('');
    setCorrection('');
    setReviseOpen(false);
    setError('');
  }

  async function logOnce() {
    if (!estimate) return;
    setBusy('log');
    setError('');
    try {
      // Send the ingredient list so the server estimates micros (centralized).
      const ingredients = (estimate.ingredients || [])
        .map(i => ({ name: i.name, amount: i.quantity, unit: i.unit }))
        .filter(i => i.name);
      await createCustomLog({
        date: getLocalDateISO(),
        name: estimate.mealName.trim() || 'Meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ...(ingredients.length ? { ingredients } : {}),
      });
      navigate('/', { state: { scrollToTop: true } });
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  async function saveAsRecipe() {
    if (!estimate) return;
    setBusy('save');
    setError('');
    try {
      const ingredients = estimate.ingredients
        .map(i => {
          const amount = `${i.quantity ? i.quantity : ''} ${i.unit || ''}`.trim() || 'as estimated';
          return { kind: 'line', name: i.name, amount };
        })
        .filter(i => i.name);
      await createRecipe({
        name: estimate.mealName.trim() || 'Meal',
        serving_size: '1 meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ingredients,
      });
      navigate(`/recipes?saved=${encodeURIComponent('Recipe saved from AI estimate.')}`);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  const conf = estimate ? (CONFIDENCE_META[estimate.confidence] || CONFIDENCE_META.medium) : null;

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>AI Macro Logger</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Describe a meal, review the estimate, then log it once.
      </p>

      {/* Input */}
      <div className="card" style={{ marginBottom: 18 }}>
        <label htmlFor="ai-meal-desc">Describe your meal</label>
        <textarea
          id="ai-meal-desc"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={5}
          style={{ width: '100%', resize: 'vertical', minHeight: 110, fontSize: '1rem', lineHeight: 1.5 }}
        />
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => runEstimate('')}
            disabled={loading || !description.trim()}
            style={{ minHeight: 48, fontWeight: 700 }}
          >
            {loading ? 'Estimating…' : estimate ? 'Re-generate from scratch' : 'Generate estimate'}
          </button>
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {/* Loading state */}
      {loading && !estimate && (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Estimating macros from your description… this usually takes a few seconds.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !estimate && !error && (
        <p className="empty-state" style={{ padding: 16 }}>
          Your estimate will appear here. Describe a meal above and tap <strong>Generate estimate</strong>.
        </p>
      )}

      {/* Review */}
      {estimate && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Review estimate</h3>

          <div style={{ marginBottom: 12 }}>
            <label>Meal name</label>
            <input
              value={estimate.mealName}
              onChange={e => setEstimate(prev => ({ ...prev, mealName: e.target.value }))}
            />
          </div>

          {conf && (
            <div
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                background: conf.bg,
                border: `1px solid ${conf.border}`,
                color: conf.color,
                marginBottom: 12,
              }}
            >
              {conf.label}
            </div>
          )}

          {estimate.summary && (
            <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--color-text-body)' }}>{estimate.summary}</p>
          )}

          {/* Ingredient rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {estimate.ingredients.length === 0 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No ingredients were identified.</p>
            )}
            {estimate.ingredients.map((ing, idx) => (
              <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                  {ing.name}
                  <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 13 }}>
                    {ing.quantity ? `${ing.quantity} ${ing.unit}`.trim() : ing.unit}
                    {STATE_LABELS[ing.state] ? ` · ${STATE_LABELS[ing.state]}` : ''}
                  </span>
                </div>
                {ing.notes && (
                  <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--color-text-faint)' }}>{ing.notes}</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 8, marginTop: 8 }}>
                  {[
                    ['calories', 'Cal'],
                    ['protein', 'P (g)'],
                    ['carbs', 'C (g)'],
                    ['fat', 'F (g)'],
                  ].map(([field, label]) => (
                    <div key={field}>
                      <label style={{ fontSize: 11 }}>{label}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={ing[field]}
                        onChange={e => updateMacro(idx, field, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ marginTop: 16, padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <strong style={{ color: '#1e3a8a' }}>Totals</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#0f172a' }}>
              {Math.round(totals.calories)} cal · P {totals.protein.toFixed(1)}g · C {totals.carbs.toFixed(1)}g · F {totals.fat.toFixed(1)}g
            </div>
          </div>

          {/* Assumptions / warnings */}
          {estimate.assumptions.length > 0 && (
            <div style={{ marginTop: 14, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
              <strong>Assumptions</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {estimate.warnings.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              <strong>Please double-check</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {estimate.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Revise */}
          <div style={{ marginTop: 16 }}>
            {!reviseOpen ? (
              <button type="button" className="btn-secondary" onClick={() => setReviseOpen(true)}>
                Revise estimate…
              </button>
            ) : (
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#f9fafb' }}>
                <label htmlFor="ai-correction">What should change?</label>
                <input
                  id="ai-correction"
                  value={correction}
                  onChange={e => setCorrection(e.target.value)}
                  placeholder="e.g. the rice was dry weight, not cooked"
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => runEstimate(correction)}
                    disabled={loading || !correction.trim()}
                  >
                    {loading ? 'Revising…' : 'Apply correction'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setReviseOpen(false); setCorrection(''); }}>
                    Cancel
                  </button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Re-sends your description plus this correction. You can also edit the macro values above by hand.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <div>
              <button
                type="button"
                className="btn-primary"
                onClick={logOnce}
                disabled={busy !== ''}
                style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                {busy === 'log' ? 'Logging…' : 'Log once'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Track this meal today without saving it to your recipe library.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn-secondary"
                onClick={saveAsRecipe}
                disabled={busy !== ''}
                style={{ width: '100%', minHeight: 48, fontWeight: 700 }}
              >
                {busy === 'save' ? 'Saving…' : 'Save as recipe'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Add this to your recipe library so you can reuse it later.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={clearAll} disabled={busy !== ''} style={{ alignSelf: 'flex-start' }}>
              Clear
            </button>
          </div>

          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
