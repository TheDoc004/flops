import { computeEntryMacros } from '@shared/utils/macros';
import { nutrientsNeedingAttention, statusFor } from '@shared/utils/microNutrients';
import MicroNutrientPanel from './MicroNutrientPanel';

/**
 * Full single-day breakdown: macro summary, meals, micronutrient panel, and
 * "needs attention" nutrients. Header-agnostic so it can be the top-level daily
 * report or the body of an expandable day card inside a range report.
 *
 * @param day { date, entries[], totals:{calories,protein_g,carbs_g,fat_g}, micros: <sumDayMicros result> }
 */
export default function DayReport({ day }) {
  const entries = day?.entries || [];
  const totals = day?.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const micros = day?.micros || null;
  const fiber = micros?.values?.fiber_g;
  const attention = micros?.hasMicros ? nutrientsNeedingAttention(micros.values) : [];

  return (
    <div>
      {/* Macro summary */}
      <div style={{ padding: '12px 14px', border: '1px solid #e8e4dc', borderRadius: 10, background: '#faf9f7', marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
          <strong>{Math.round(totals.calories).toLocaleString('en-US')}</strong> cal
          {' · '}P {totals.protein_g.toFixed(1)}g
          {' · '}C {totals.carbs_g.toFixed(1)}g
          {' · '}F {totals.fat_g.toFixed(1)}g
          {Number.isFinite(fiber) && fiber > 0 ? ` · Fiber ${Math.round(fiber * 10) / 10}g` : ''}
        </p>
      </div>

      {/* Meals (read-only — editing lives in the Logged Day Explorer) */}
      <h3 className="subsection-title" style={{ marginBottom: 8 }}>
        Meals {entries.length > 0 ? `(${entries.length})` : ''}
      </h3>
      {entries.length === 0 ? (
        <p className="empty-state" style={{ padding: 12 }}>No meals logged this day.</p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {entries.map(e => {
            const mm = computeEntryMacros(e);
            return (
              <div key={e.id} style={{ padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{e.recipe_name || 'Meal'}</span>
                  <span style={{ fontSize: 13, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{Math.round(mm.calories)}</strong> cal
                    {' · '}P {mm.protein_g.toFixed(0)}g
                    {' · '}C {mm.carbs_g.toFixed(0)}g
                    {' · '}F {mm.fat_g.toFixed(0)}g
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Nutrients needing attention — chips share the bar status colors. */}
      {attention.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: '#faf9f7', border: '1px solid #e8e4dc', borderRadius: 10 }}>
          <strong style={{ fontSize: 13, color: '#1e1b4b' }}>Needs attention</strong>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {attention.map(a => {
              const st = statusFor(a.key, a.value);
              return (
                <span
                  key={a.key}
                  style={{
                    fontSize: 12, color: st.textColor, background: '#fff',
                    border: `1px solid ${st.color}`, borderRadius: 999, padding: '3px 9px',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.color, flexShrink: 0 }} aria-hidden="true" />
                  {a.name} {Math.round(a.pct * 100)}%
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Micronutrient panel */}
      <MicroNutrientPanel
        values={micros?.values}
        confidence={micros?.confidence}
        coverage={micros?.coverage}
        supplementCount={micros?.supplementCount}
      />
    </div>
  );
}
