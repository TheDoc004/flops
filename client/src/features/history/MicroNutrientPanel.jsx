import { MICRO_GROUPS, MICRO_ESTIMATE_NOTE } from '@shared/config/microNutrients';
import { MICRO_LEGEND } from '@shared/utils/microNutrients';
import MicroNutrientBar from '@shared/ui/MicroNutrientBar';

const CONF_LABEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };

/* Compact color key — colors mean status, not nutrient identity. */
function MicroLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', marginBottom: 16 }}>
      {MICRO_LEGEND.map(item => (
        <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: item.color, flexShrink: 0 }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Daily micronutrient panel — all v1 nutrients, grouped by Vitamins / Minerals /
 * Other, each as a progress bar. Shows coverage + confidence and the estimate
 * disclaimer. Never crashes on missing micros (renders a friendly empty state).
 *
 * @param values    summed day micros { key: amount }
 * @param confidence day-level confidence (low|medium|high) or null
 * @param coverage  { withMicros, total } meals contributing estimates
 */
export default function MicroNutrientPanel({ values, confidence = null, coverage = null }) {
  const hasMicros = values && Object.keys(values).length > 0;

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
            {confidence && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#5b21b6',
                background: '#ede9fe', border: '1px solid #c4b5fd',
                borderRadius: 999, padding: '3px 10px',
              }}>
                {CONF_LABEL[confidence] || confidence}
              </span>
            )}
          </div>
        )}
      </div>

      {!hasMicros ? (
        <p className="empty-state" style={{ padding: 14 }}>
          No micronutrient estimates here yet. Ingredient-based logs — saved recipes, Meal Builder meals,
          and AI Macro Logger meals — include estimated micros when logged.
        </p>
      ) : (
        <>
          <MicroLegend />
          {MICRO_GROUPS.map(group => (
            <div key={group.key} style={{ marginBottom: 18 }}>
              <h4 style={{
                margin: '0 0 10px', fontSize: 14, fontWeight: 600,
                color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
              }}>
                {group.label}
              </h4>
              {group.nutrients.map(n => (
                <MicroNutrientBar
                  key={n.key}
                  nutrientKey={n.key}
                  value={values[n.key] || 0}
                />
              ))}
            </div>
          ))}
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
            {MICRO_ESTIMATE_NOTE}
          </p>
        </>
      )}
    </div>
  );
}
