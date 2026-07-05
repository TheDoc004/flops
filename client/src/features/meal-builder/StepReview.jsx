import { Link } from 'react-router-dom';
import { macroSummaryText } from './builderUtils';

/**
 * Wizard step 2 — name the meal, review the ingredient recap and totals,
 * then log it once or save it to the recipe library (or save changes when
 * editing an existing recipe).
 */
export default function StepReview({
  recipeId,
  mealName,
  setMealName,
  lines,
  lineMacros,
  ingById,
  totals,
  mealSaveError,
  mealSaved,
  mealLoggedOnce,
  loggingOnce,
  onSaveMeal,
  onLogOnce,
  onBack,
  onBackToDashboard,
  backToDashboardRef,
}) {
  const rows = lines
    .map((l, idx) => {
      const ing = ingById[l.labelIngredientId];
      const m = lineMacros[idx];
      if (!ing || !m) return null;
      return {
        id: l.id,
        name: ing.name,
        role: String(l.roleLabel || '').trim(),
        amount: l.amount,
        unit: ing.tracking_type === 'unit' ? (ing.unit_name || 'unit') : l.unit,
        subsCount: (l.substitute_label_ingredient_ids || []).length,
        m,
      };
    })
    .filter(Boolean);

  return (
    <form onSubmit={onSaveMeal}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">{recipeId ? 'Review & save your changes' : 'Review your meal'}</h3>
        {recipeId && (
          <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--color-text-muted)' }}>
            Editing recipe #{recipeId} — saving updates it.
          </p>
        )}

        <div style={{ marginBottom: 16 }}>
          <label>Meal name</label>
          <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="e.g. Meal prep bowl #1" required />
        </div>

        {rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 15, color: 'var(--color-text-muted)' }}>
            No ingredients yet — go back and add at least one.
          </p>
        ) : (
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {rows.length} ingredient{rows.length === 1 ? '' : 's'}
            </p>
            {rows.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-divider-warm)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                    {r.role ? `${r.role} — ${r.name}` : r.name}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {r.amount} {r.unit}
                    {r.subsCount > 0 && ` · ${r.subsCount} substitute${r.subsCount === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {macroSummaryText(r.m)}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: 14, background: '#f9fafb', borderRadius: 8 }}>
              <strong style={{ fontSize: 15 }}>Meal totals</strong>
              <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }}>
                {macroSummaryText(totals, { fiber: true })}
              </div>
            </div>
          </div>
        )}

        {mealSaveError && <p className="error">{mealSaveError}</p>}
        {mealSaved && (
          <p style={{ color: 'var(--color-success)', fontSize: 14 }}>
            Saved to your library. <Link to="/recipes" style={{ color: 'var(--color-link)' }}>Open Recipe Library</Link>
          </p>
        )}
        {mealLoggedOnce && (
          <p style={{ color: 'var(--color-success)', fontSize: 14 }}>
            Logged to today. It&apos;s in your daily log — not saved to your Recipe Library.
          </p>
        )}

        {recipeId ? (
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', minHeight: 72, fontSize: '1.25rem', fontWeight: 700, marginTop: 16, borderRadius: 14, letterSpacing: '-0.01em' }}
          >
            Save changes
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <div>
              <button
                type="button"
                onClick={onLogOnce}
                className={loggingOnce ? 'btn-secondary btn-loading' : 'btn-secondary'}
                disabled={loggingOnce}
                style={{ width: '100%', minHeight: 60, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                {loggingOnce ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>) : 'Log once'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Logs to today only — not saved to your library.
              </p>
            </div>
            <div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', minHeight: 60, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                Save as recipe
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Saves to your library so you can log it again.
              </p>
            </div>
          </div>
        )}
        {(mealSaved || mealLoggedOnce) && (
          <button
            ref={backToDashboardRef}
            type="button"
            className="btn-secondary"
            onClick={onBackToDashboard}
            style={{
              width: '100%',
              minHeight: 64,
              fontSize: '1.15rem',
              fontWeight: 700,
              marginTop: 12,
              borderRadius: 14,
              letterSpacing: '-0.01em',
            }}
          >
            Back to Dashboard
          </button>
        )}
      </div>

      <div className="wizard-nav">
        <button type="button" className="btn-secondary wizard-back" onClick={onBack}>
          ← Back
        </button>
      </div>
    </form>
  );
}
