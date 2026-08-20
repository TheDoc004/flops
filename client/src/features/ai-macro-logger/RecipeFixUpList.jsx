import { useState } from 'react';
import { likelyLibraryMatches, searchLibrary } from './ingredientSource';
import { amountFor } from './recipeCommand';

/**
 * The "couldn't apply" list in the recipe review — with a way out.
 *
 * A change the AI couldn't resolve (an ingredient it has no macros for, a
 * substitute it doesn't recognize) would otherwise be logged as if it never
 * happened, quietly undercounting the meal. Each fixable item gets a button to
 * point it at a saved ingredient; picking one re-runs the modification through
 * the normal library path, so the result is identical to an AI-matched swap.
 *
 * @param items      unapplied entries from applyModifications
 * @param library    saved ingredient library
 * @param onResolve  (item, ingredient, amount, unit) => void
 */
export default function RecipeFixUpList({ items, library, onResolve }) {
  const [open, setOpen] = useState(null);   // modIndex of the item being fixed
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('g');

  if (!items?.length) return null;

  function startFix(item) {
    setOpen(item.modIndex);
    setQuery('');
    setPicked(null);
    setAmount(item.fix.quantity != null ? String(item.fix.quantity) : '');
    setUnit(item.fix.unit || 'g');
  }

  function choose(item, ing) {
    setPicked(ing);
    // Seed the amount from what the AI asked for; fall back to one serving of
    // the chosen ingredient so the fields are never blank.
    const [a, u] = amountFor(ing, item.fix.quantity, item.fix.unit);
    setAmount(String(a));
    setUnit(u);
  }

  return (
    <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, marginBottom: 12, fontSize: 13, color: '#92400e' }}>
      <strong>Couldn’t apply — not included in the totals below:</strong>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => {
          const isOpen = item.fix && open === item.modIndex;
          const options = isOpen
            ? (query.trim() ? searchLibrary(query, library) : likelyLibraryMatches(item.fix.name, library))
            : [];
          return (
            <div key={item.modIndex} style={{ borderTop: '1px solid #fde68a', paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                  {item.text} — <span style={{ color: '#a16207' }}>{item.reason}</span>
                </span>
                {item.fix && !isOpen && (
                  <button type="button" className="btn-secondary" onClick={() => startFix(item)} style={{ minHeight: 34, padding: '0 12px', fontSize: 12.5, flexShrink: 0 }}>
                    Pick ingredient
                  </button>
                )}
              </div>

              {isOpen && (
                <div style={{ marginTop: 8, padding: 10, background: '#fff', border: '1px solid #fde68a', borderRadius: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-strong)', marginBottom: 6 }}>
                    Which saved ingredient is “{item.fix.name}”?
                  </div>
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search your ingredient library…"
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  {options.length === 0 ? (
                    <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {query.trim() ? 'No saved ingredient matches that search.' : 'Nothing in your library looks like this — try searching.'}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {options.slice(0, 8).map(ing => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => choose(item, ing)}
                          style={{
                            border: `1px solid ${picked?.id === ing.id ? '#059669' : '#e5e7eb'}`,
                            background: picked?.id === ing.id ? '#ecfdf5' : '#fff',
                            color: 'var(--color-text-strong)',
                            borderRadius: 999, padding: '5px 11px', fontSize: 13, cursor: 'pointer',
                          }}
                        >
                          {ing.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label htmlFor={`fix-amt-${item.modIndex}`} style={{ margin: 0, fontSize: 13 }}>Amount</label>
                    <input
                      id={`fix-amt-${item.modIndex}`}
                      type="number" min="0" step="any"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      style={{ width: 90 }}
                    />
                    <input
                      aria-label="Unit"
                      value={unit}
                      onChange={e => setUnit(e.target.value)}
                      style={{ width: 80 }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!picked || !(Number(amount) > 0)}
                      onClick={() => { onResolve(item, picked, Number(amount), unit); setOpen(null); setPicked(null); }}
                      style={{ minHeight: 38, padding: '0 14px' }}
                    >
                      Use this
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { setOpen(null); setPicked(null); }} style={{ minHeight: 38, padding: '0 14px' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
