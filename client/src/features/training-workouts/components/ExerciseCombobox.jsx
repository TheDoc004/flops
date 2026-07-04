import { useEffect, useMemo, useRef, useState } from 'react';
import useDropdownPlacement from '@shared/hooks/useDropdownPlacement';

function preventOptionMouseDown(e) {
  e.preventDefault();
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Autocomplete input for exercise names. Filters from a library of exercise objects,
 * but also accepts free-text (user can type any name not in the library).
 *
 * @param {object} p
 * @param {Array<{id: number, name: string, primary_muscle: string, movement_type: string, equipment: string}>} p.library
 * @param {string} p.value
 * @param {(name: string) => void} p.onChange
 * @param {string} [p.placeholder]
 * @param {boolean} [p.disabled]
 */
export default function ExerciseCombobox({
  library = [],
  value = '',
  onChange,
  placeholder = 'Search or type exercise name…',
  disabled = false,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { openUp, maxHeight } = useDropdownPlacement(inputRef, open, 260);

  const filtered = useMemo(() => {
    const q = value.toLowerCase().trim();
    if (!q) return library.slice(0, 50);
    return library.filter(e => e.name.toLowerCase().includes(q)).slice(0, 50);
  }, [library, value]);

  useEffect(() => {
    function onDocPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, []);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  function selectExercise(name) {
    onChange(name);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex(i => clamp(i + 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => clamp(i - 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'Enter' && open && filtered.length > 0) {
      e.preventDefault();
      selectExercise((filtered[activeIndex] || filtered[0]).name);
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoComplete="off"
        /* No onFocus opener: the list should not pop open on programmatic or
           tab focus. It opens on click, typing, or ↓. */
        onClick={() => { if (!disabled) setOpen(true); }}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-expanded={open ? 'true' : 'false'}
      />

      {open && filtered.length > 0 && (
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
          {filtered.map((ex, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={ex.id}
                type="button"
                role="option"
                data-active={isActive ? '1' : '0'}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={preventOptionMouseDown}
                onClick={() => selectExercise(ex.name)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: isActive ? '#eff6ff' : 'transparent',
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                }}
              >
                <strong style={{ fontSize: 14 }}>{ex.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
                  {ex.primary_muscle} · {ex.equipment}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
