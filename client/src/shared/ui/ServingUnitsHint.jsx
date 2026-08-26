import { loggableUnitsForServing } from '@shared/utils/servingBasis';

const list = units => units.join(', ');

/**
 * Explains what the gram-equivalent field buys you, in terms of the units this
 * ingredient will accept at log time. Without it a per-cup or per-filet
 * ingredient can only ever be logged by that unit; with it, weights work too.
 */
export default function ServingUnitsHint({ serving, unitName }) {
  const { now, unlocked } = loggableUnitsForServing(serving);
  if (now.length === 0) return null;
  return (
    <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--color-text-muted)' }}>
      {unlocked.length > 0 ? (
        <>
          You can log this in <strong>{list(now)}</strong>. Record what one {unitName} weighs
          and <strong>{list(unlocked)}</strong> work too.
        </>
      ) : (
        <>You can log this in <strong>{list(now)}</strong>.</>
      )}
    </p>
  );
}
