/**
 * Numbered step header for the Meal Builder wizard. Completed steps show a
 * check and can be tapped to go back; forward navigation happens through the
 * Continue buttons inside each step.
 */
export default function WizardStepper({ steps, current, onSelect }) {
  const currentIdx = steps.findIndex(s => s.key === current);
  return (
    <div className="wizard-steps" role="list" aria-label="Meal builder steps">
      {steps.map((s, idx) => {
        const done = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const clickable = done;
        return (
          <button
            key={s.key}
            type="button"
            role="listitem"
            className={[
              'wizard-step',
              done && 'is-done',
              isCurrent && 'is-current',
              clickable && 'is-clickable',
            ].filter(Boolean).join(' ')}
            onClick={clickable ? () => onSelect(s.key) : undefined}
            disabled={!clickable && !isCurrent}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="wizard-step-num" aria-hidden="true">
              {done ? '✓' : idx + 1}
            </span>
            <span className="wizard-step-label">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
