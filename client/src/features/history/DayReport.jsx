import { LogEntryRow } from '@features/meal-logging';
import { nutrientsNeedingAttention, statusFor } from '@shared/utils/microNutrients';
import Reveal from '@shared/ui/Reveal';
import MicroNutrientPanel from './MicroNutrientPanel';

/**
 * Full single-day breakdown: macro summary, meals, micronutrient panel, and
 * "needs attention" nutrients. Header-agnostic so it can be the top-level daily
 * report or the body of an expandable day card inside a range report.
 *
 * Meals are the same expandable `LogEntryRow` used everywhere else, so a day can
 * be fixed where it's being read — tap a meal for its per-ingredient macros and
 * micros, edit it, delete it, or add one that was missed. This replaced a
 * separate "Edit a logged day" card that carried its own duplicate calendar.
 *
 * @param day { date, entries[], totals:{calories,protein_g,carbs_g,fat_g}, supplementTotals?, micros: <sumDayMicros result> }
 * @param onAddMeal    optional (date) => void — omit to render the day read-only
 * @param onEditMeal   optional (entry) => void
 * @param onDeleteMeal optional (entry) => void
 */
export default function DayReport({ day, onAddMeal, onEditMeal, onDeleteMeal }) {
  const editable = typeof onAddMeal === 'function';
  const entries = day?.entries || [];
  const totals = day?.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const suppTotals = day?.supplementTotals || null;
  // The totals line covers meals + macro-counting supplements, so say so when
  // supplements are in there — otherwise the meal list looks like it's short.
  const suppCalories = Math.round(suppTotals?.calories || 0);
  const suppCounted =
    !!suppTotals &&
    (suppTotals.calories > 0 || suppTotals.protein_g > 0 || suppTotals.carbs_g > 0 || suppTotals.fat_g > 0);
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
        {suppCounted && (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            Includes supplements: {suppCalories.toLocaleString('en-US')} cal
            {' · '}P {suppTotals.protein_g.toFixed(1)}g
            {' · '}C {suppTotals.carbs_g.toFixed(1)}g
            {' · '}F {suppTotals.fat_g.toFixed(1)}g
          </p>
        )}
      </div>

      {/* Meals — tap one to expand its macros/micros; edit and delete in place. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h3 className="subsection-title" style={{ margin: 0 }}>
          Meals {entries.length > 0 ? `(${entries.length})` : ''}
        </h3>
        {editable && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onAddMeal(day.date)}
            style={{ minHeight: 0, padding: '7px 14px', fontSize: 13 }}
          >
            + Add meal
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="empty-state" style={{ padding: 12 }}>No meals logged this day.</p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {entries.map((e, idx) => (
            <Reveal key={e.id} delay={Math.min(idx, 6) * 60}>
              <LogEntryRow
                entry={e}
                onEdit={editable ? () => onEditMeal(e) : undefined}
                onDelete={editable ? onDeleteMeal : undefined}
              />
            </Reveal>
          ))}
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
