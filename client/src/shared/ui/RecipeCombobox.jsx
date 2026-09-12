import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { filterRecipesByName } from '@shared/utils/recipeSearch';
import useDropdownPlacement from '@shared/hooks/useDropdownPlacement';

/** Stops the search input from blurring before `click` on an option, so selection commits on click. */
function preventOptionMouseDown(e) {
  e.preventDefault();
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Subtitle under an ingredient's name: how it's measured, plus its calories. */
function ingredientMeta(i) {
  const basis = i.tracking_type === 'unit' && i.unit_name
    ? `per ${i.serving_quantity != null ? i.serving_quantity : 1} ${i.unit_name}`
    : i.serving_size_text;
  return [basis, i.calories != null ? `${i.calories} cal` : null].filter(Boolean).join(' · ');
}

/**
 * Picker for a saved recipe. Pass `ingredients` to also search the Ingredient
 * Library in the same box (grouped headers). Log Meal uses both: recipes seed
 * the meal; ingredients append a line.
 *
 * @param {object} p
 * @param {Array<{id: number|string, name: string, serving_size?: string}>} p.recipes
 * @param {Array<{id: number|string, name: string}>} [p.ingredients] empty = recipes only
 * @param {string|number|null} p.value id of the current selection
 * @param {(nextId: string, kind: 'recipe'|'ingredient') => void} p.onChange
 * @param {'recipe'|'ingredient'} [p.valueKind] which list `value` refers to
 * @param {string} [p.label]
 * @param {string} [p.placeholder]
 * @param {boolean} [p.disabled]
 */
const RecipeCombobox = forwardRef(function RecipeCombobox({
  recipes,
  ingredients = [],
  value,
  valueKind = 'recipe',
  onChange,
  label = 'Recipe',
  placeholder = 'Search recipe or meal…',
  disabled = false,
}, ref) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus() { inputRef.current?.focus(); },
  }), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const { openUp, maxHeight } = useDropdownPlacement(inputRef, open, 260);

  const selected = useMemo(() => {
    const pool = valueKind === 'ingredient' ? ingredients : recipes;
    return Array.isArray(pool) ? pool.find(r => String(r.id) === String(value)) || null : null;
  }, [recipes, ingredients, value, valueKind]);

  /* One flat list so arrow keys run straight through both groups; each option
     carries its kind, and a header is drawn wherever the kind changes. */
  const list = useMemo(() => {
    const asOptions = (items, kind) =>
      filterRecipesByName(items || [], query).map(item => ({ kind, item }));
    return [...asOptions(recipes, 'recipe'), ...asOptions(ingredients, 'ingredient')];
  }, [recipes, ingredients, query]);

  useEffect(() => {
    function onDocPointerDown(e) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector?.(`[data-active="1"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const poolCount = (recipes?.length || 0) + (ingredients?.length || 0);
  const showEmpty = poolCount > 0 && list.length === 0;

  const inputValue = open ? query : (selected ? selected.name : query);

  function selectOption(opt) {
    onChange(String(opt.item.id), opt.kind);
    setQuery('');
    setOpen(false);
    // keep focus for fast logging
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActiveIndex(i => clamp(i + 1, 0, Math.max(0, list.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActiveIndex(i => clamp(i - 1, 0, Math.max(0, list.length - 1)));
      return;
    }
    if (e.key === 'Enter') {
      if (!open) return;
      if (list.length === 0) return;
      e.preventDefault();
      selectOption(list[activeIndex] || list[0]);
    }
  }

  return (
    <div ref={rootRef}>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="search"
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          autoComplete="off"
          /* No onFocus opener: the modal autofocuses this input, and the list
             should not pop open uninvited. It opens on click, typing, or ↓. */
          onClick={() => { if (!disabled) setOpen(true); }}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          aria-expanded={open ? 'true' : 'false'}
        />

        {open && (
          <div
            ref={listRef}
            role="listbox"
            className="dropdown-in"
            style={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
              transformOrigin: openUp ? 'bottom center' : 'top center',
              ...(openUp ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
              maxHeight,
              overflowY: 'auto',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              boxShadow: '0 10px 28px rgba(0,0,0,0.08)',
              padding: 6,
            }}
          >
            {poolCount === 0 ? (
              <div className="empty-state" style={{ padding: 10 }}>
                {ingredients.length > 0 ? 'No recipes or ingredients yet.' : 'No recipes yet.'}
              </div>
            ) : showEmpty ? (
              <div className="empty-state" style={{ padding: 10 }}>
                No matches for &quot;{query.trim()}&quot;.
              </div>
            ) : (
              list.slice(0, 80).map((opt, idx) => {
                const { kind, item } = opt;
                const isSelected = selected && kind === valueKind && String(selected.id) === String(item.id);
                const isActive = idx === activeIndex;
                /* Headers only earn their space when both groups are on show. */
                const showHeader = ingredients.length > 0 && (idx === 0 || list[idx - 1].kind !== kind);
                const meta = kind === 'ingredient'
                  ? ingredientMeta(item)
                  : (item.serving_size ? `per ${item.serving_size}` : '');
                return (
                  <div key={`${kind}-${item.id}`}>
                    {showHeader && (
                      <div
                        role="presentation"
                        style={{
                          padding: '8px 10px 4px',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: 'var(--color-text-faint)',
                        }}
                      >
                        {kind === 'recipe' ? 'Recipes' : 'Ingredients'}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      data-active={isActive ? '1' : '0'}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={preventOptionMouseDown}
                      onClick={() => selectOption(opt)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: isActive ? '#eff6ff' : 'transparent',
                        borderRadius: 8,
                        padding: '12px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <strong>{item.name}</strong>
                          {meta ? (
                            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                              {meta}
                            </span>
                          ) : null}
                        </div>
                        {isSelected ? (
                          <span style={{ fontSize: 12, color: 'var(--color-link)', fontWeight: 600 }}>
                            Selected
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default RecipeCombobox;

