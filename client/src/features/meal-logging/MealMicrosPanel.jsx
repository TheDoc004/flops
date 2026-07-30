import { MICRO_GROUPS, MICRO_BY_KEY } from '@shared/config/microNutrients';
import { parseMicros } from '@shared/utils/microNutrients';

const CONF_NOTE = {
  high: 'From product labels',
  medium: 'Partly estimated',
  low: 'Rough estimate',
};

function fmtAmount(v, unit) {
  const n = Number(v) || 0;
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${r} ${unit}`;
}

/**
 * Compact micronutrient readout for ONE meal — the "Micros" half of the meal
 * row's Macros/Micros toggle. Deliberately lighter than the daily History
 * panel: no bars or legend, just the nutrients this meal actually contains,
 * grouped, with the amount and its share of the daily target.
 *
 * Stored micros describe one serving; amounts here are scaled by the logged
 * servings, matching how sumDayMicros folds them into the day totals.
 */
export default function MealMicrosPanel({ entry }) {
  const blob = parseMicros(entry);
  if (!blob) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
        No micronutrient estimate for this meal — it may have been logged before
        micros existed.
      </p>
    );
  }

  const servings = Number(entry?.servings) > 0 ? Number(entry.servings) : 1;
  const groups = MICRO_GROUPS
    .map(g => ({
      ...g,
      rows: g.nutrients
        .filter(n => Number(blob.micros[n.key]) > 0)
        .map(n => ({ ...n, value: Number(blob.micros[n.key]) * servings })),
    }))
    .filter(g => g.rows.length > 0);

  if (groups.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
        No micronutrients recorded for this meal.
      </p>
    );
  }

  return (
    <div>
      {groups.map(group => (
        <div key={group.key} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            {group.label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '4px 18px' }}>
            {group.rows.map(n => {
              const def = MICRO_BY_KEY[n.key];
              const targetRef = def?.watch ? def?.upperLimit : def?.target;
              const pct = targetRef ? Math.round((n.value / targetRef) * 100) : null;
              return (
                <div key={n.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                  <span style={{ color: '#4b5563' }}>{n.name}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontWeight: 600, color: '#1f2937' }}>{fmtAmount(n.value, n.unit)}</span>
                    {pct != null && (
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)', minWidth: 34, textAlign: 'right' }}>
                        {pct}%{def?.watch ? ' of limit' : ''}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-faint)' }}>
        {blob.notes || CONF_NOTE[blob.confidence] || ''}
        {blob.notes ? '' : ' · % of daily target'}
      </p>
    </div>
  );
}
