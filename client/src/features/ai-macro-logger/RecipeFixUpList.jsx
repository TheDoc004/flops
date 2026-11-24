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
    <div className="ai-fixups">
      <strong>Couldn’t apply — not included in the totals below:</strong>
      <div className="ai-fixups__list">
        {items.map(item => {
          const isOpen = item.fix && open === item.modIndex;
          const options = isOpen
            ? (query.trim() ? searchLibrary(query, library) : likelyLibraryMatches(item.fix.name, library))
            : [];
          return (
            <div key={item.modIndex} className="ai-fixups__item">
              <div className="ai-fixups__line">
                <span className="ai-fixups__text">
                  {item.text} — <span className="ai-fixups__reason">{item.reason}</span>
                </span>
                {item.fix && !isOpen && (
                  <button type="button" className="btn-secondary ai-logger__btn-sm" onClick={() => startFix(item)}>
                    Pick ingredient
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="ai-fixups__picker">
                  <div className="ai-fixups__question">
                    Which saved ingredient is “{item.fix.name}”?
                  </div>
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search your ingredient library…"
                    className="ai-fixups__search"
                  />
                  {options.length === 0 ? (
                    <p className="ai-fixups__empty">
                      {query.trim() ? 'No saved ingredient matches that search.' : 'Nothing in your library looks like this — try searching.'}
                    </p>
                  ) : (
                    <div className="ai-fixups__chips">
                      {options.slice(0, 8).map(ing => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => choose(item, ing)}
                          className={picked?.id === ing.id ? 'ai-fixups__chip is-picked' : 'ai-fixups__chip'}
                        >
                          {ing.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="ai-fixups__amount">
                    <label htmlFor={`fix-amt-${item.modIndex}`}>Amount</label>
                    <input
                      id={`fix-amt-${item.modIndex}`}
                      type="number" inputMode="decimal" min="0" step="any"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="ai-fixups__qty"
                    />
                    <input
                      aria-label="Unit"
                      value={unit}
                      onChange={e => setUnit(e.target.value)}
                      className="ai-fixups__unit"
                    />
                  </div>
                  <div className="ai-logger__actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!picked || !(Number(amount) > 0)}
                      onClick={() => { onResolve(item, picked, Number(amount), unit); setOpen(null); setPicked(null); }}
                    >
                      Use this
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { setOpen(null); setPicked(null); }}>
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
