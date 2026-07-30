import { useState } from 'react';
import { MICRO_GROUPS } from '@shared/config/microNutrients';
import { parseMicros } from '@shared/utils/microNutrients';

/**
 * A nutrient only earns a bar when this meal covers at least this share of
 * its daily target (or limit) — a 6% trace is noise at meal level, 20% is a
 * real contribution. Everything under the line stays reachable via the
 * "smaller contributions" toggle rather than silently disappearing.
 */
const MIN_SHARE = 0.1;

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
 * Micronutrients for ONE meal — the "Micros" half of the meal row toggle.
 *
 * Each nutrient the meal contains gets a small progress bar answering one
 * question: how much of today's target does this meal alone cover? ("This
 * breakfast is 50% of your vitamin A.") Amounts are scaled by the logged
 * servings, matching how sumDayMicros folds them into day totals.
 */
export default function MealMicrosPanel({ entry }) {
  const [showAll, setShowAll] = useState(false);
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
  // Two passes: compute every present nutrient's share first, then filter —
  // so the "N smaller" count is derived, never mutated during render.
  const allGroups = MICRO_GROUPS.map(g => ({
    ...g,
    rows: g.nutrients
      .filter(n => Number(blob.micros[n.key]) > 0)
      .map(n => {
        const value = Number(blob.micros[n.key]) * servings;
        const targetRef = n.watch ? n.upperLimit : n.target;
        return { ...n, value, share: targetRef ? value / targetRef : 0 };
      }),
  }));
  const minorCount = allGroups.reduce(
    (count, g) => count + g.rows.filter(n => n.share < MIN_SHARE).length,
    0
  );
  const groups = allGroups
    .map(g => ({ ...g, rows: g.rows.filter(n => showAll || n.share >= MIN_SHARE) }))
    .filter(g => g.rows.length > 0);

  if (groups.length === 0) {
    // Everything present is a trace amount — say so instead of a bare empty state.
    if (minorCount > 0) {
      return (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
          Nothing above {Math.round(MIN_SHARE * 100)}% of a daily target —{' '}
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
        How much of your daily targets this meal covers
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
          Show {minorCount} smaller contribution{minorCount === 1 ? '' : 's'} (under {Math.round(MIN_SHARE * 100)}%)
        </button>
      )}
      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-faint)' }}>
        {blob.notes || CONF_NOTE[blob.confidence] || ''}
      </p>
    </div>
  );
}
