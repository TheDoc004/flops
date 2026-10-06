import { useState } from 'react';
import { MICRO_GROUPS, MICRO_ESTIMATE_NOTE } from '@shared/config/microNutrients';
import { MICRO_LEGEND, statusFor, nutrientsNeedingAttention } from '@shared/utils/microNutrients';
import MicroNutrientBar from '@shared/ui/MicroNutrientBar';

const CONF_LABEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };

/* Compact color key — colors mean status, not nutrient identity. */
function MicroLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', marginBottom: 14 }}>
      {MICRO_LEGEND.map(item => (
        <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: item.color, flexShrink: 0 }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** "9 of 13 on track" for a group — good/over for targets, under-limit for watch. */
function groupSummary(group, values) {
  let onTrack = 0;
  for (const n of group.nutrients) {
    const s = statusFor(n.key, values[n.key] || 0);
    if (s.isWatch ? !s.over : s.pct >= 0.75) onTrack += 1;
  }
  return { onTrack, total: group.nutrients.length };
}

/**
 * Daily micronutrient panel, sectioned so 28 nutrients don't land as one wall
 * of bars: a "needs attention" strip answers the headline question, then each
 * category (Vitamins / Minerals / Omega-3s) is a collapsible section
 * whose header carries an on-track summary — open only what you want to read.
 */
export default function MicroNutrientPanel({ values, confidence = null, coverage = null, supplementCount = 0 }) {
  const hasMicros = values && Object.keys(values).length > 0;
  // Which category sections are open. Default all closed: the attention strip
  // plus the per-group summaries carry the headline.
  const [open, setOpen] = useState({});
  const attention = hasMicros ? nutrientsNeedingAttention(values, { limit: 4 }) : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 className="subsection-title" style={{ margin: 0 }}>Micronutrients</h3>
        {hasMicros && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {coverage && coverage.total > 0 && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {coverage.withMicros} of {coverage.total} meal{coverage.total === 1 ? '' : 's'} estimated
              </span>
            )}
            {supplementCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#1d7a5f',
                background: '#ecfdf5', border: '1px solid #6ee7b7',
                borderRadius: 999, padding: '3px 10px',
              }}>
                + {supplementCount} supplement{supplementCount === 1 ? '' : 's'}
              </span>
            )}
            {confidence && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-primary-ink)',
                background: 'var(--color-primary-subtle)', border: '1px solid #bfdbfe',
                borderRadius: 999, padding: '3px 10px',
              }}>
                {CONF_LABEL[confidence] || confidence}
              </span>
            )}
          </div>
        )}
      </div>

      {hasMicros && coverage?.missingIngredients?.length > 0 && (
        <p style={{ margin: '-4px 0 12px', fontSize: 12.5, color: 'var(--color-warning-ink)' }}>
          Not counted — no micronutrient data yet for {coverage.missingIngredients.join(', ')}.
          These totals are low by whatever {coverage.missingIngredients.length === 1 ? 'it contributes' : 'they contribute'}.
        </p>
      )}

      {!hasMicros ? (
        <p className="empty-state" style={{ padding: 14 }}>
          No micronutrient estimates yet.
        </p>
      ) : (
        <>
          {/* The headline first: what actually needs work today. */}
          {attention.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>
                Needs attention
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attention.map(a => (
                  <span
                    key={a.key}
                    style={{
                      fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 11px',
                      color: a.pct < 0.34 ? '#9b2c2c' : '#92400e',
                      background: a.pct < 0.34 ? '#fdf0ef' : '#fdf6ec',
                      border: `1px solid ${a.pct < 0.34 ? '#eecaca' : '#efd9b4'}`,
                    }}
                  >
                    {a.name} · {Math.round(a.pct * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <MicroLegend />

          {MICRO_GROUPS.map(group => {
            const sum = groupSummary(group, values);
            const isOpen = !!open[group.key];
            return (
              <div key={group.key} style={{ border: '1px solid #ece8e1', borderRadius: 10, marginBottom: 8, background: '#fff' }}>
                <button
                  type="button"
                  onClick={() => setOpen(o => ({ ...o, [group.key]: !o[group.key] }))}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    width: '100%', padding: '10px 14px', minHeight: 44, background: 'none', border: 'none',
                    cursor: 'pointer', font: 'inherit', textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: '#9ca3af', fontSize: 12 }}>▸</span>
                    <span style={{
                      fontSize: 14, fontWeight: 600, color: 'var(--color-primary-ink)',
                      fontFamily: 'var(--font-sans)',
                    }}>
                      {group.label}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: sum.onTrack === sum.total ? '#1d7a5f' : '#6b7280', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {sum.onTrack} of {sum.total} on track
                  </span>
                </button>
                <div className={`collapse${isOpen ? ' is-open' : ''}`}>
                  <div className="collapse__inner">
                    <div style={{ padding: '2px 14px 12px' }}>
                      {group.nutrients.map(n => (
                        <MicroNutrientBar key={n.key} nutrientKey={n.key} value={values[n.key] || 0} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
            {MICRO_ESTIMATE_NOTE}
            {supplementCount > 0 ? ' Supplement values are taken exactly from their labels.' : ''}
          </p>
        </>
      )}
    </div>
  );
}
