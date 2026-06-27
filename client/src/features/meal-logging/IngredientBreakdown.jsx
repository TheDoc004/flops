import { formatMacroMass } from '@shared/utils/macroUnits';
import { scaleIngredientRows } from '@shared/utils/macros';

const COLS = '1.5fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr';

/**
 * Compact per-ingredient macro table for a logged meal (Phase 1). Rows are
 * stored per-serving; we scale by the entry's servings so the breakdown lines
 * up with the displayed meal total. Renders nothing when there are no rows.
 */
export default function IngredientBreakdown({ rows, servings = 1, macroUnits }) {
  const scaled = scaleIngredientRows(rows, servings);
  if (!scaled.length) return null;

  const cell = (extra) => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...extra });

  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Ingredient breakdown</p>
      <div style={{ fontSize: 11.5 }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, color: '#9ca3af', fontWeight: 600, paddingBottom: 4 }}>
          <span>Ingredient</span>
          <span>Amount</span>
          <span style={cell()}>Cal</span>
          <span style={cell()}>P</span>
          <span style={cell()}>C</span>
          <span style={cell()}>F</span>
        </div>
        {scaled.map((r, i) => (
          <div
            key={i}
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, padding: '5px 0', borderTop: '1px solid #f3f4f6', alignItems: 'baseline' }}
          >
            <span style={{ color: '#1f2937', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
              {r.name}
              {(r.source === 'ai' || r.source === 'estimated') && (
                <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 600, color: '#9ca3af' }} title="AI estimate — not from your saved library">est</span>
              )}
            </span>
            <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.amount != null ? `${+Number(r.amount).toFixed(2)}${r.unit ? ` ${r.unit}` : ''}` : (r.unit || '—')}
            </span>
            <span style={cell()}>{Math.round(r.calories)}</span>
            <span style={cell()}>{formatMacroMass(r.protein_g, macroUnits)}</span>
            <span style={cell()}>{formatMacroMass(r.carbs_g, macroUnits)}</span>
            <span style={cell()}>{formatMacroMass(r.fat_g, macroUnits)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
