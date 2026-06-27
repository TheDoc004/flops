import { useMemo, useState } from 'react';
import { computeEntryMacros, parseLoggedIngredients, scaleIngredientRows } from '@shared/utils/macros';
import { computeTrainingWindow, ACTIVITY_TYPES, INTENSITIES } from '@shared/utils/trainingWindow';

const STATUS_STYLE = {
  too_soon: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
  almost_ready: { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
  good_window: { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46' },
  best_window: { bg: '#ecfdf5', border: '#34d399', color: '#065f46' },
  past_ideal: { bg: '#f3f4f6', border: '#e5e7eb', color: '#6b7280' },
};

/** Most recent meal today: latest by eaten-time, else the last logged. */
function mostRecentMeal(entries) {
  if (!entries || !entries.length) return null;
  const withTime = entries.filter(e => Number.isFinite(e.time_min));
  if (withTime.length) return withTime.reduce((a, b) => (b.time_min >= a.time_min ? b : a));
  return entries[entries.length - 1];
}

/** Build the engine's meal shape from a logged entry (macros + scaled ingredient rows). */
function mealFromEntry(entry) {
  const m = computeEntryMacros(entry);
  const servings = Number(entry.servings) > 0 ? Number(entry.servings) : 1;
  const rows = scaleIngredientRows(parseLoggedIngredients(entry) || [], servings);
  let fiber = rows.reduce((acc, r) => acc + (Number(r.fiber_g) || 0), 0);
  if (!fiber && entry.recipe_fiber_g != null) fiber = (Number(entry.recipe_fiber_g) || 0) * servings;
  const ingredients = rows.map(r => ({
    name: r.name,
    calories: Number(r.calories) || 0,
    protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0,
    fat: Number(r.fat_g) || 0,
    fiber: Number(r.fiber_g) || 0,
  }));
  return {
    totalCalories: m.calories, protein: m.protein_g, carbs: m.carbs_g, fat: m.fat_g, fiber,
    ingredients,
    eatenMinutesOfDay: Number.isFinite(entry.time_min) ? entry.time_min : null,
  };
}

const Pill = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      minHeight: 0, padding: '5px 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      border: active ? '1px solid #312e81' : '1px solid #e5e7eb',
      background: active ? '#312e81' : '#fff',
      color: active ? '#fff' : '#4b5563',
    }}
  >
    {children}
  </button>
);

/**
 * Training Fuel Timing Assistant — estimates the post-meal training window for
 * the user's most recent meal and updates live as the activity / intensity
 * selectors change. Deterministic; no AI call.
 */
export default function TrainingFuelCard({ entries }) {
  const [activityType, setActivityType] = useState('lifting');
  const [intensity, setIntensity] = useState('moderate');

  const entry = useMemo(() => mostRecentMeal(entries), [entries]);
  const result = useMemo(() => {
    if (!entry) return null;
    const meal = mealFromEntry(entry);
    const now = new Date();
    meal.nowMinutesOfDay = now.getHours() * 60 + now.getMinutes();
    return computeTrainingWindow(meal, { type: activityType, intensity });
  }, [entry, activityType, intensity]);

  if (!entry || !result) return null;
  const showIntensity = activityType !== 'walk' && activityType !== 'rest';
  const st = STATUS_STYLE[result.status] || STATUS_STYLE.best_window;

  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Ready to train?</h3>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          from your latest meal · {entry.recipe_name}
        </span>
      </div>

      {/* Activity quick-select */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {ACTIVITY_TYPES.map(a => (
          <Pill key={a.value} active={activityType === a.value} onClick={() => setActivityType(a.value)}>{a.label}</Pill>
        ))}
      </div>
      {showIntensity && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginRight: 2 }}>Intensity</span>
          {INTENSITIES.map(i => (
            <Pill key={i.value} active={intensity === i.value} onClick={() => setIntensity(i.value)}>{i.label}</Pill>
          ))}
        </div>
      )}

      {/* Status + window */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <span style={{
          fontSize: 12.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
          background: st.bg, border: `1px solid ${st.border}`, color: st.color,
        }}>
          {result.title}
        </span>
        <strong style={{ fontSize: 15, color: 'var(--color-text-strong)' }}>
          Best window: {result.idealStartMinutesAfterMeal}–{result.idealEndMinutesAfterMeal} min after eating
        </strong>
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--color-text-body)', lineHeight: 1.5 }}>
        {result.message}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
        Reason: {result.reasonText}
      </p>

      {result.suggestions.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          {result.suggestions.map((s, i) => <li key={i} style={{ marginTop: 2 }}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}
