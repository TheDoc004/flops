import { statusFor } from '@shared/utils/microNutrients';

const CONF_DOT = {
  low: { color: '#f59e0b', title: 'Low confidence estimate' },
  medium: { color: '#3b82f6', title: 'Medium confidence estimate' },
  high: { color: '#10b981', title: 'High confidence estimate' },
};

function fmtAmount(v, unit) {
  const n = Number(v) || 0;
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${r} ${unit}`;
}

/**
 * One micronutrient row: name · consumed/target · percent (right) · progress bar.
 * Pure presentation — colors/limits come from statusFor(). Safe on missing values.
 */
export default function MicroNutrientBar({ nutrientKey, value = 0, confidence = null }) {
  const s = statusFor(nutrientKey, value);
  const def = s.def;
  if (!def) return null;

  const targetRef = def.watch ? def.upperLimit : def.target;
  const pctLabel = Math.round((targetRef ? (Number(value) || 0) / targetRef : 0) * 100);
  const dot = confidence ? CONF_DOT[confidence] : null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {def.name}
          {dot && (
            <span
              title={dot.title}
              aria-label={dot.title}
              style={{ width: 7, height: 7, borderRadius: '50%', background: dot.color, display: 'inline-block', flexShrink: 0 }}
            />
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
            {fmtAmount(value, def.unit)} / {fmtAmount(targetRef, def.unit)}{def.watch ? ' limit' : ''}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: s.textColor, minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {pctLabel}%
          </span>
        </span>
      </div>
      <div style={{ height: 8, background: s.track, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(s.fillPct * 100, 100)}%`, height: '100%', background: s.color, borderRadius: 999, transition: 'width 0.25s ease' }} />
      </div>
      {(s.over || s.isWatch) && (
        <div style={{ fontSize: 11, color: s.textColor, marginTop: 3, fontWeight: 500 }}>{s.label}</div>
      )}
    </div>
  );
}
