import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import useDropdownPlacement from '@shared/hooks/useDropdownPlacement';
import PreppedIndicator from '@shared/ui/PreppedIndicator';

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
}

function normalizeDateMs(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Stops the search input from blurring before `click` on an option, so selection commits on click. */
function preventOptionMouseDown(e) {
  e.preventDefault();
}

function filterByName(items, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!q) return [...list].sort(byName);
  const matches = list.filter(r => String(r.name).toLowerCase().includes(q));
  function rank(name) {
    const n = String(name).toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  }
  return matches.sort((a, b) => {
    const ra = rank(a.name);
    const rb = rank(b.name);
    if (ra !== rb) return ra - rb;
    return byName(a, b);
  });
}

function ItemTitle({ item }) {
  return (
    <>
      <strong>{item.name}</strong>
      {item.is_prepped_batch ? (
        <PreppedIndicator detail={item.serving_size_text} className="ingredient-combobox__prepped" />
      ) : null}
      {!item.is_prepped_batch && item.brand_name ? (
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{item.brand_name}</span>
      ) : null}
    </>
  );
}

function ItemMeta({ item }) {
  if (item.is_prepped_batch) return null;
  return (
    <>
      {item.grams_per_serving != null ? (
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{item.grams_per_serving}g/serving</span>
      ) : null}
      {item.serving_size_text ? (
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{item.serving_size_text}</span>
      ) : null}
    </>
  );
}

/**
 * @param {object} p
 * @param {Array<{id: number|string, name: string, serving_size_text?: string, grams_per_serving?: number|null, use_count?: number, last_used_at?: string|null}>} p.items
 * @param {string|number|null} p.value
 * @param {(nextId: string) => void} p.onChange
 * @param {string} [p.label]
 * @param {string} [p.placeholder]
 * @param {boolean} [p.disabled]
 * @param {boolean} [p.allowCreate] — show “Create new ingredient” (Meal Builder inline flow)
 * @param {(prefillName: string) => void} [p.onRequestCreate] — called with current search text as name hint
 * @param {() => void} [p.onSelect] — called after an item is selected; if provided, focus management is handed to the caller
 * @param {Array|null} [p.suggestions] — when provided, replaces the default (no-query) list with this short curated set; typing still searches all items
 */
const IngredientCombobox = forwardRef(function IngredientCombobox({
  items,
  value,
  onChange,
  label = 'Ingredient',
  placeholder = 'Search ingredients…',
  disabled = false,
  allowCreate = false,
  onRequestCreate,
  onSelect,
  suggestions = null,
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
  const { openUp, maxHeight } = useDropdownPlacement(inputRef, open, 280);

  const selected = useMemo(
    () => (Array.isArray(items) ? items.find(r => String(r.id) === String(value)) : null),
    [items, value]
  );

  const recent = useMemo(() => {
    const list = (items || []).filter(x => normalizeDateMs(x.last_used_at) > 0 && !x.is_prepped_batch);
    return list.sort((a, b) => normalizeDateMs(b.last_used_at) - normalizeDateMs(a.last_used_at)).slice(0, 8);
  }, [items]);

  const frequent = useMemo(() => {
    const list = (items || []).filter(x => Number(x.use_count || 0) > 0 && !x.is_prepped_batch);
    return list.sort((a, b) => Number(b.use_count || 0) - Number(a.use_count || 0)).slice(0, 8);
  }, [items]);

  const preppedItems = useMemo(
    () => (items || []).filter(x => x.is_prepped_batch).sort(byName),
    [items],
  );

  const libraryItems = useMemo(
    () => (items || []).filter(x => !x.is_prepped_batch),
    [items],
  );

  const filtered = useMemo(() => filterByName(items || [], query), [items, query]);
  const filteredLibrary = useMemo(() => filterByName(libraryItems, query), [libraryItems, query]);

  // When suggestions mode is active and no query, keyboard nav operates on suggestions list
  const visibleItems = useMemo(
    () => (suggestions != null && !query.trim() ? suggestions : filtered),
    [suggestions, query, filtered]
  );

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

  function selectItem(r) {
    onChange(String(r.id));
    setQuery('');
    setOpen(false);
    requestAnimationFrame(() => {
      if (onSelect) onSelect();
      else inputRef.current?.focus();
    });
  }

  function requestCreate() {
    if (!onRequestCreate) return;
    onRequestCreate(query.trim());
    setQuery('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActiveIndex(i => clamp(i + 1, 0, Math.max(0, visibleItems.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActiveIndex(i => clamp(i - 1, 0, Math.max(0, visibleItems.length - 1)));
      return;
    }
    if (e.key === 'Enter') {
      if (!open || visibleItems.length === 0) return;
      e.preventDefault();
      selectItem(visibleItems[activeIndex] || visibleItems[0]);
    }
  }

  const inputValue = open ? query : (selected ? selected.name : query);

  return (
    <div ref={rootRef}>
      {label ? <label>{label}</label> : null}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="search"
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          autoComplete="off"
          /* No onFocus opener: the list should not pop open on programmatic or
             tab focus. It opens on click, typing, or ↓. */
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
            className="dropdown-in"
            style={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
              transformOrigin: openUp ? 'bottom center' : 'top center',
              ...(openUp ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              boxShadow: '0 10px 28px rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              ref={listRef}
              role="listbox"
              style={{
                maxHeight,
                overflowY: 'auto',
                padding: 6,
              }}
            >
            {(items?.length || 0) === 0 ? (
              <div className="empty-state" style={{ padding: 10 }}>
                No saved ingredients yet.
                {allowCreate && onRequestCreate && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="btn-primary" style={{ width: '100%' }} onMouseDown={preventOptionMouseDown} onClick={requestCreate}>
                      + Create new ingredient
                    </button>
                  </div>
                )}
              </div>
            ) : query.trim() === '' && suggestions != null ? (
              // Suggestions mode: show curated list, not full library
              <div>
                {suggestions.length === 0 ? (
                  <div style={{ padding: '10px 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                    No close matches. Type to search your ingredient library.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700, padding: '6px 8px' }}>Suggested swaps</div>
                    {suggestions.map((r, idx) => {
                      const isActive = idx === activeIndex;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          role="option"
                          data-active={isActive ? '1' : '0'}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onMouseDown={preventOptionMouseDown}
                          onClick={() => selectItem(r)}
                          style={{ width: '100%', textAlign: 'left', border: 'none', background: isActive ? '#eff6ff' : 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                        >
                          <strong>{r.name}</strong>
                          {r.brand_name ? <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{r.brand_name}</span> : null}
                        </button>
                      );
                    })}
                  </>
                )}
                <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 10px', fontSize: 12, color: 'var(--color-text-faint)' }}>
                  Type to search all saved ingredients
                </div>
              </div>
            ) : query.trim() === '' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {preppedItems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700, padding: '6px 8px' }}>Prepped batches</div>
                    {preppedItems.map(r => (
                      <button
                        key={`prepped-${r.id}`}
                        type="button"
                        onMouseDown={preventOptionMouseDown}
                        onClick={() => selectItem(r)}
                        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                      >
                        <ItemTitle item={r} />
                      </button>
                    ))}
                  </div>
                )}
                {recent.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700, padding: '6px 8px' }}>Recent</div>
                    {recent.map(r => (
                      <button
                        key={`recent-${r.id}`}
                        type="button"
                        onMouseDown={preventOptionMouseDown}
                        onClick={() => selectItem(r)}
                        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                      >
                        <ItemTitle item={r} />
                        <ItemMeta item={r} />
                      </button>
                    ))}
                  </div>
                )}
                {frequent.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700, padding: '6px 8px' }}>Frequently used</div>
                    {frequent.map(r => (
                      <button
                        key={`freq-${r.id}`}
                        type="button"
                        onMouseDown={preventOptionMouseDown}
                        onClick={() => selectItem(r)}
                        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                      >
                        <ItemTitle item={r} />
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{Number(r.use_count || 0)} uses</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700, padding: '6px 8px' }}>All ingredients</div>
                  {filteredLibrary.slice(0, 30).map((r, idx) => {
                    const isActive = idx === activeIndex;
                    const isSelected = selected && String(selected.id) === String(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected ? 'true' : 'false'}
                        data-active={isActive ? '1' : '0'}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={preventOptionMouseDown}
                        onClick={() => selectItem(r)}
                        style={{ width: '100%', textAlign: 'left', border: 'none', background: isActive ? '#eff6ff' : 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                      >
                        <ItemTitle item={r} />
                        <ItemMeta item={r} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state" style={{ padding: 10 }}>
                No matches for &quot;{query.trim()}&quot;.
                {allowCreate && onRequestCreate && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="btn-primary" style={{ width: '100%' }} onMouseDown={preventOptionMouseDown} onClick={requestCreate}>
                      + Create &quot;{query.trim()}&quot; as new ingredient
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filtered.slice(0, 40).map((r, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = selected && String(selected.id) === String(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected ? 'true' : 'false'}
                    data-active={isActive ? '1' : '0'}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={preventOptionMouseDown}
                    onClick={() => selectItem(r)}
                    style={{ width: '100%', textAlign: 'left', border: 'none', background: isActive ? '#eff6ff' : 'transparent', borderRadius: 8, padding: '12px 10px', cursor: 'pointer' }}
                  >
                    <ItemTitle item={r} />
                    <ItemMeta item={r} />
                  </button>
                );
              })
            )}
            </div>
            {allowCreate && onRequestCreate && (items?.length || 0) > 0 && (
              <div
                style={{
                  borderTop: '1px solid #f3f4f6',
                  padding: '8px 10px 10px',
                  background: '#fafafa',
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 13 }}
                  onMouseDown={preventOptionMouseDown}
                  onClick={requestCreate}
                >
                  + Create new ingredient{query.trim() ? ` (“${query.trim()}”)…` : '…'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default IngredientCombobox;
