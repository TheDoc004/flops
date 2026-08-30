/**
 * Small badge for active prepped (cooked) batches — used in the ingredient
 * library, combobox, and meal receipt rows.
 */
export default function PreppedIndicator({ detail, className = '' }) {
  return (
    <span
      className={`prepped-indicator${className ? ` ${className}` : ''}`}
      title={detail ? `Prepped batch · ${detail}` : 'Active prepped batch'}
    >
      Prepped
      {detail ? <span className="prepped-indicator__detail">{detail}</span> : null}
    </span>
  );
}
