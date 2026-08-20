import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { MACRO_COLORS } from '@shared/utils/colors';
import useAnimatedNumber from '@shared/hooks/useAnimatedNumber';

const RING_COLORS = {
  Calories: MACRO_COLORS.calories,
  Protein:  MACRO_COLORS.protein,
  Carbs:    MACRO_COLORS.carbs,
  Fat:      MACRO_COLORS.fat,
};

function MacroCell({ label, value, target, macroUnits }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const animated = useAnimatedNumber(value);

  const hasTarget = target?.max != null;
  const isCalories = label === 'Calories';

  const pct = hasTarget ? Math.min((value / target.max) * 100, 100) : 0;
  const offset = circumference - (pct / 100) * circumference;
  const pctDisplay = hasTarget
    ? Math.round(Math.min((animated / target.max) * 100, 100))
    : 0;

  const belowMin = hasTarget && value < target.min;
  const overMax  = hasTarget && value > target.max;
  const inRange  = hasTarget && !belowMin && !overMax;

  const ringColor = overMax ? 'var(--color-danger)' : RING_COLORS[label];

  const displayVal = isCalories
    ? Math.round(animated).toLocaleString('en-US')
    : formatMacroMass(animated, macroUnits);

  const hasRange = hasTarget && Math.abs(target.max - target.min) > 0.5;

  function fmtGoal(n) {
    return isCalories ? Math.round(n).toLocaleString('en-US') : formatMacroMass(n, macroUnits);
  }

  const goalDisplay = hasTarget
    ? hasRange
      ? `${fmtGoal(target.min)}–${fmtGoal(target.max)}`
      : fmtGoal(target.max)
    : null;

  let statusText = 'No goal set';
  let statusMod = 'muted';
  if (hasTarget) {
    if (overMax) {
      statusText = `${fmtGoal(value - target.max)} over`;
      statusMod = 'over';
    } else if (inRange) {
      statusText = 'In range';
      statusMod = 'ok';
    } else {
      statusText = `${fmtGoal(target.min - value)} to range`;
      statusMod = 'muted';
    }
  }

  return (
    <div className="macro-cell">
      <div className="macro-ring" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" stroke="var(--color-ring-track)" />
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{
              stroke: ringColor,
              strokeDashoffset: hasTarget ? offset : circumference,
            }}
          />
        </svg>
        <span className={`macro-ring-pct${overMax ? ' is-over' : ''}`}>
          {hasTarget ? `${pctDisplay}%` : '–'}
        </span>
      </div>
      <div className="macro-meta">
        <p className="macro-label">{label}</p>
        <p className="macro-value">{displayVal}</p>
        <p className={`macro-status is-${statusMod}`}>{statusText}</p>
        {goalDisplay && <p className="macro-range">{goalDisplay}</p>}
      </div>
    </div>
  );
}

export default function MacroTotals({ totals, targets }) {
  const { macroUnits } = useMacroUnits();

  return (
    <div className="macro-strip">
      <MacroCell label="Calories" value={totals.calories}  target={targets.calories}  macroUnits={macroUnits} />
      <MacroCell label="Protein"  value={totals.protein_g} target={targets.protein_g} macroUnits={macroUnits} />
      <MacroCell label="Carbs"    value={totals.carbs_g}   target={targets.carbs_g}   macroUnits={macroUnits} />
      <MacroCell label="Fat"      value={totals.fat_g}     target={targets.fat_g}     macroUnits={macroUnits} />
    </div>
  );
}
