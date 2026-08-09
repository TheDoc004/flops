import { useState } from 'react';
import { MICRO_GROUPS } from '@shared/config/microNutrients';
import { parseMicros, dominantNutrients, TRACE_FLOOR } from '@shared/utils/microNutrients';

const CONF_NOTE = {
  high: 'From product labels',
  medium: 'Partly estimated',
  low: 'Rough estimate',
};

// One neutral accent for every bar. Deliberately NOT the day panel's status
// palette: a meal covering 30% of a target is a fine meal, not a "low" day,
// so red/amber grading would send the wrong message here.
const BAR_FILL = '#6366f1';
const BAR_TRACK = '#eef1f4';

function fmtAmount(v, unit) {
  const n = Number(v) || 0;
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${r} ${unit}`;
}

/**
 * Micronutrients for ONE meal or recipe — the "Micros" half of the row toggle.
 *
 * Each nutrient shown gets a small progress bar answering one question: how
 * much of today's target does this alone cover? ("This breakfast is 50% of your
 * vitamin A.") Amounts are scaled by the logged servings, matching how
 * sumDayMicros folds them into day totals.
 *
 * Only the nutrients the food is actually notable for are listed by default
 * (see dominantNutrients) — the rest stay one click away rather than turning
 * the panel into a 28-row wall.
 *
 * @param caption  overrides the default header line (recipes qualify that the
 *                 numbers describe their default amounts)
 * @param emptyNote  overrides the "no estimate" copy for non-log contexts
 */
export default function MealMicrosPanel({ entry, caption, emptyNote }) {
  const [showAll, setShowAll] = useState(false);
  const blob = parseMicros(entry);
  if (!blob) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
        {emptyNote || 'No micronutrient estimate for this meal — it may have been logged before micros existed.'}
      </p>
    );
  }

  const servings = Number(entry?.servings) > 0 ? Number(entry.servings) : 1;
  const scaled = {};
  for (const [key, v] of Object.entries(blob.micros)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) scaled[key] = n * servings;
  }
  const { shown, hidden } = dominantNutrients(scaled);
  const visible = new Map((showAll ? [...shown, ...hidden] : shown).map(r => [r.key, r]));
  const minorCount = hidden.length;

  // Group the survivors so the panel keeps its Vitamins / Minerals structure.
  const groups = MICRO_GROUPS
    .map(g => ({
      ...g,
      rows: g.nutrients
        .filter(n => visible.has(n.key))
        .map(n => ({ ...n, value: visible.get(n.key).value, share: visible.get(n.key).share })),
    }))
    .filter(g => g.rows.length > 0);

  if (groups.length === 0) {
    // Everything present is a trace amount — say so instead of a bare empty state.
    if (minorCount > 0) {
      return (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
          Nothing above {Math.round(TRACE_FLOOR * 100)}% of a daily target —{' '}
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-link)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            show {minorCount} smaller contribution{minorCount === 1 ? '' : 's'}
          </button>
          .
        </p>
      );
    }
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
        No micronutrients recorded for this meal.
      </p>
    );
  }

  // Stagger index shared across groups so the whole panel fills top-down.
  let barIndex = 0;

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#6b7280' }}>
        {caption || 'How much of your daily targets this meal covers'}
      </p>
      {groups.map(group => (
        <div key={group.key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {group.label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px 22px' }}>
            {group.rows.map(n => {
              const pct = n.share * 100;
              const i = barIndex++;
              return (
                <div key={n.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{n.name}</span>
                    <span style={{ fontSize: 12, color: '#6b7280', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtAmount(n.value, n.unit)} · {Math.round(pct)}%{n.watch ? ' of limit' : ''}
                    </span>
                  </div>
                  <div style={{ height: 6, background: BAR_TRACK, borderRadius: 999, marginTop: 5, overflow: 'hidden' }}>
                    <div
                      className="meal-micro-fill"
                      style={{
                        '--i': i,
                        width: `${Math.min(pct, 100)}%`,
                        height: '100%',
                        background: BAR_FILL,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {minorCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            background: 'none', border: 'none', padding: '2px 0', font: 'inherit',
            fontSize: 12.5, color: 'var(--color-link)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Show {minorCount} more nutrient{minorCount === 1 ? '' : 's'}
        </button>
      )}
      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-faint)' }}>
        {blob.notes || CONF_NOTE[blob.confidence] || ''}
      </p>
    </div>
  );
}
