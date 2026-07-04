import { formatMacroMass } from '@shared/utils/macroUnits';
import { scaleIngredientRows } from '@shared/utils/macros';
import { MACRO_COLORS } from '@shared/utils/colors';

// column-gap is 0 so the macro values center inside the panel segments below
// them; Ingredient/Amount get their breathing room from cell padding instead.
const COLS = '1.5fr 0.9fr 0.85fr 0.85fr 0.85fr 0.85fr';

// Macro columns reuse the canonical chart/summary colors for tint + text. Full
// words (not shorthand) since there's room; the label always stays, so the
// table never relies on color alone.
const MACRO_COLS = [
  { key: 'calories', label: 'Calories', color: MACRO_COLORS.calories, value: (r) => Math.round(r.calories) },
  { key: 'protein',  label: 'Protein',  color: MACRO_COLORS.protein,  value: (r, u) => formatMacroMass(r.protein_g, u) },
  { key: 'carbs',    label: 'Carbs',    color: MACRO_COLORS.carbs,    value: (r, u) => formatMacroMass(r.carbs_g, u) },
  { key: 'fat',      label: 'Fat',      color: MACRO_COLORS.fat,      value: (r, u) => formatMacroMass(r.fat_g, u) },
];

// Low-alpha tint from a canonical macro hex — used for the column segment fill.
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Compact per-ingredient macro table for a logged meal (Phase 1). Rows are
 * stored per-serving; we scale by the entry's servings so the breakdown lines
 * up with the displayed meal total. Renders nothing when there are no rows.
 *
 * The four macro columns form one enclosed, rounded panel (see `.bd*` in
 * index.css): each column has a light tint, neutral dividers between them, and
 * complete left/right edges. `open` drives the coordinated reveal — header
 * first, then rows cascade top→bottom while the tints fade and the neutral
 * dividers draw downward. It replays every time `open` flips true.
 */
export default function IngredientBreakdown({ rows, servings = 1, macroUnits, open = false }) {
  const scaled = scaleIngredientRows(rows, servings);
  if (!scaled.length) return null;

  // --rn is the reveal count (header + data rows) that drives the stagger math.
  const gridRow = { display: 'grid', gridTemplateColumns: COLS, columnGap: 0, alignItems: 'baseline' };

  return (
    <div className={`bd${open ? ' is-open' : ''}`} style={{ '--rn': scaled.length + 1 }}>
      <p style={{ margin: '0 0 8px', fontSize: 'var(--text-secondary)', color: '#6b7280', fontWeight: 600 }}>Ingredient breakdown</p>
      <div className="bd-table" style={{ fontSize: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {/* The enclosed macro panel sits behind the text, spanning tracks 3–6. */}
        <div className="bd-lanes" aria-hidden="true" style={{ gridTemplateColumns: COLS }}>
          <div className="bd-panel">
            {MACRO_COLS.map((col, ci) => (
              <div key={col.key} className="bd-seg" style={{ '--lane-tint': hexToRgba(col.color, 0.09) }}>
                {ci > 0 && <span className="bd-seg__div" />}
              </div>
            ))}
          </div>
        </div>

        {/* Header appears first (--i:0). */}
        <div className="bd-head" style={{ ...gridRow, '--i': 0, color: '#6b7280', fontWeight: 600, fontSize: 'var(--text-caption)', paddingBottom: 8, alignItems: 'end' }}>
          <span style={{ paddingRight: 12 }}>Ingredient</span>
          <span style={{ paddingRight: 14 }}>Amount</span>
          {MACRO_COLS.map((col) => (
            <span key={col.key} className="bd-h" style={{ color: col.color }}>
              <span
                className="bd-dot"
                aria-hidden="true"
                style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: col.color, marginRight: 4, verticalAlign: 'middle' }}
              />
              {col.label}
            </span>
          ))}
        </div>

        {scaled.map((r, i) => (
          <div
            key={i}
            className="bd-row"
            style={{ ...gridRow, '--i': i + 1, padding: '7px 0', borderTop: '1px solid #f3f4f6' }}
          >
            <span style={{ color: '#1f2937', fontSize: 'var(--text-body)', fontWeight: 600, paddingRight: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
              {r.name}
              {(r.source === 'ai' || r.source === 'estimated') && (
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#9ca3af' }} title="AI estimate — not from your saved library">est</span>
              )}
            </span>
            <span style={{ color: '#6b7280', paddingRight: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.amount != null ? `${+Number(r.amount).toFixed(2)}${r.unit ? ` ${r.unit}` : ''}` : (r.unit || '—')}
            </span>
            {MACRO_COLS.map((col) => (
              <span key={col.key} className="bd-val" style={{ color: col.color, fontWeight: 600 }}>
                {col.value(r, macroUnits)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
