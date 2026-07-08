import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { MACRO_COLORS } from '@shared/utils/colors';

const RING_COLORS = {
  Calories: MACRO_COLORS.calories,
  Protein:  MACRO_COLORS.protein,
  Carbs:    MACRO_COLORS.carbs,
  Fat:      MACRO_COLORS.fat,
};

function MacroRing({ label, value, target, macroUnits }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  const hasTarget = target?.max != null;
  const isCalories = label === 'Calories';

  // Progress ring always fills toward the upper bound (max)
  const pct = hasTarget ? Math.min((value / target.max) * 100, 100) : 0;
  const offset = circumference - (pct / 100) * circumference;
  const pctDisplay = Math.round(pct);

  // Range-aware status
  const belowMin = hasTarget && value < target.min;
  const overMax  = hasTarget && value > target.max;
  const inRange  = hasTarget && !belowMin && !overMax;

  const ringColor = overMax ? 'var(--color-danger)' : RING_COLORS[label];

  // Current value display
  const displayVal = isCalories
    ? Math.round(value).toLocaleString('en-US')
    : formatMacroMass(value, macroUnits);

  // Goal display — show range if min ≠ max, otherwise just max
  const hasRange = hasTarget && Math.abs(target.max - target.min) > 0.5;

  function fmtGoal(n) {
    return isCalories ? Math.round(n).toLocaleString('en-US') : formatMacroMass(n, macroUnits);
  }

  const goalDisplay = hasTarget
    ? hasRange
      ? `${fmtGoal(target.min)}–${fmtGoal(target.max)}`
      : fmtGoal(target.max)
    : null;

  // Status text and color
  let statusText = null;
  let statusColor = 'var(--color-text-muted)';

  if (hasTarget) {
    if (overMax) {
      const excess = value - target.max;
      statusText = `${fmtGoal(excess)} over`;
      statusColor = 'var(--color-danger)';
    } else if (inRange) {
      statusText = 'In range';
      statusColor = '#065f46';
    } else {
      // below min
      const deficit = target.min - value;
      statusText = `${fmtGoal(deficit)} to range`;
      statusColor = 'var(--color-text-muted)';
    }
  }

  return (
    <div className="macro-ring-card">
      {/* Ring scales up on desktop via CSS width/height (viewBox stays 64), so
          the stroke + percentage badge grow proportionally; mobile stays at 64. */}
      <div style={{ position: 'relative', flexShrink: 0, width: 'clamp(64px, 5.4vw, 78px)', height: 'clamp(64px, 5.4vw, 78px)' }}>
        <svg viewBox="0 0 64 64" style={{ width: '100%', height: '100%', display: 'block', transform: 'rotate(-90deg)' }} aria-hidden="true">
          {/* Track */}
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" stroke="#ede9fe" />
          {/* Fill — strokeDashoffset in style enables CSS transition */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{
              stroke: ringColor,
              strokeDashoffset: hasTarget ? offset : circumference,
              transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease',
            }}
          />
        </svg>
        <span style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'clamp(11px, 0.95vw, 13px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: overMax ? 'var(--color-danger)' : 'var(--color-primary-ink)',
        }}>
          {hasTarget ? `${pctDisplay}%` : '—'}
        </span>
      </div>

      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 'clamp(11px, 0.9vw, 12.5px)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </p>
        <p style={{ margin: '4px 0 2px', fontSize: 'clamp(20px, 1.9vw, 25px)', fontWeight: 700, color: 'var(--color-text-strong)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {displayVal}
        </p>
        {goalDisplay && (
          <p style={{ margin: '2px 0 2px', fontSize: 'clamp(11px, 0.9vw, 12.5px)', color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
            Goal: {goalDisplay}
          </p>
        )}
        {statusText && (
          <p style={{ margin: 0, fontSize: 'clamp(12px, 0.95vw, 13.5px)', color: statusColor, fontWeight: inRange ? 600 : 400 }}>
            {inRange && (
              <span style={{ marginRight: 3 }}>✓</span>
            )}
            {statusText}
          </p>
        )}
        {!hasTarget && (
          <p style={{ margin: 0, fontSize: 'clamp(12px, 0.95vw, 13.5px)', color: 'var(--color-text-muted)' }}>No goal set</p>
        )}
      </div>
    </div>
  );
}

export default function MacroTotals({ totals, targets }) {
  const { macroUnits } = useMacroUnits();

  return (
    <div className="macro-grid" style={{ marginBottom: 0 }}>
      <MacroRing label="Calories" value={totals.calories}  target={targets.calories}  macroUnits={macroUnits} />
      <MacroRing label="Protein"  value={totals.protein_g} target={targets.protein_g} macroUnits={macroUnits} />
      <MacroRing label="Carbs"    value={totals.carbs_g}   target={targets.carbs_g}   macroUnits={macroUnits} />
      <MacroRing label="Fat"      value={totals.fat_g}     target={targets.fat_g}     macroUnits={macroUnits} />
    </div>
  );
}
