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

/**
 * @param {object} p
 * @param {Array<{id: number|string, name: string, serving_size?: string}>} p.recipes
 * @param {string|number|null} p.value
 * @param {(nextId: string) => void} p.onChange
 * @param {string} [p.label]
 * @param {string} [p.placeholder]
 * @param {boolean} [p.disabled]
 */
const RecipeCombobox = forwardRef(function RecipeCombobox({
  recipes,
  value,
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

  const selected = useMemo(
    () => (Array.isArray(recipes) ? recipes.find(r => String(r.id) === String(value)) : null),
    [recipes, value]
  );

  const filtered = useMemo(() => filterRecipesByName(recipes || [], query), [recipes, query]);

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

  const list = filtered;
  const showEmpty = (recipes?.length || 0) > 0 && list.length === 0;

  const inputValue = open ? query : (selected ? selected.name : query);

  function selectRecipe(r) {
    onChange(String(r.id));
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
      selectRecipe(list[activeIndex] || list[0]);
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
          onFocus={() => { if (!disabled) setOpen(true); }}
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
            style={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
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
            {recipes?.length === 0 ? (
              <div className="empty-state" style={{ padding: 10 }}>
                No recipes yet.
              </div>
            ) : showEmpty ? (
              <div className="empty-state" style={{ padding: 10 }}>
                No matches for &quot;{query.trim()}&quot;.
              </div>
            ) : (
              list.slice(0, 80).map((r, idx) => {
                const isSelected = selected && String(selected.id) === String(r.id);
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected ? 'true' : 'false'}
                    data-active={isActive ? '1' : '0'}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={preventOptionMouseDown}
                    onClick={() => selectRecipe(r)}
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
                        <strong>{r.name}</strong>
                        {r.serving_size ? (
                          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                            per {r.serving_size}
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

