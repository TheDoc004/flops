/**
 * Dose display helpers, mirroring server/supplementDose.js.
 *
 * Kept in their own module (not a component file) so both the modal and the
 * dashboard card can share them without breaking fast refresh.
 */

/** "softgel" + 3 -> "softgels"; abbreviations and 1 stay as they are. */
export function formatDoseUnit(unit, qty) {
  const u = String(unit ?? '').trim();
  if (!u || Number(qty) === 1) return u;
  if (/^(g|mg|mcg|ml|oz|iu)$/i.test(u)) return u;
  if (/y$/i.test(u) && !/[aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(u)) return `${u}es`;
  return `${u}s`;
}

/** "3 softgels", falling back to a previous display when the unit is unknown. */
export function formatDose(qty, unit, previous) {
  const u = String(unit || '').trim();
  if (!u) return previous || String(qty);
  return `${qty} ${formatDoseUnit(u, qty)}`;
}
