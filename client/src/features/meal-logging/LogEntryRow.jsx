import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { computeEntryMacros, mealMacroCalorieBreakdown, parseLoggedIngredients } from '@shared/utils/macros';
import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { MACRO_COLORS } from '@shared/utils/colors';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import IngredientBreakdown from './IngredientBreakdown';
import MealMicrosPanel from './MealMicrosPanel';
import ViewToggle from './ViewToggle';
import { parseMicros } from '@shared/utils/microNutrients';

const PIE_COLORS = { protein: MACRO_COLORS.protein, carbs: MACRO_COLORS.carbs, fat: MACRO_COLORS.fat };

/** Meal-row ⋯ menu — same pop + outside-click pattern as SortMenu in RangeReport. */
function MealRowMenu({ onMacros, onMicros, onCopyMeal, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocPointerDown(e) {
      if (!rootRef.current || rootRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  const hasActions = onMacros || onMicros || onCopyMeal || onDelete;
  if (!hasActions) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn-secondary meal-row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Meal actions"
        title="Meal actions"
        onClick={() => setOpen(v => !v)}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="menu-pop dropdown-in"
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, minWidth: 168, transformOrigin: 'top right' }}
        >
          {onMacros && (
            <button
              type="button"
              role="menuitem"
              className="menu-pop-item"
              onClick={() => { onMacros(); setOpen(false); }}
            >
              Macros
            </button>
          )}
          {onMicros && (
            <button
              type="button"
              role="menuitem"
              className="menu-pop-item"
              onClick={() => { onMicros(); setOpen(false); }}
            >
              Micros
            </button>
          )}
          {onCopyMeal && (
            <button
              type="button"
              role="menuitem"
              className="menu-pop-item"
              onClick={() => { onCopyMeal(); setOpen(false); }}
            >
              Copy Meal
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className="menu-pop-item is-danger"
              onClick={() => { onDelete(); setOpen(false); }}
            >
              Remove from day
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function buildPieData(entry) {
  const cal = mealMacroCalorieBreakdown(entry);
  const total = cal.protein + cal.carbs + cal.fat;
  if (total <= 0) return { rows: [], total: 0 };
  return {
    total,
    rows: [
      { name: 'Protein', value: cal.protein, fill: PIE_COLORS.protein },
      { name: 'Carbs',   value: cal.carbs,   fill: PIE_COLORS.carbs },
      { name: 'Fat',     value: cal.fat,     fill: PIE_COLORS.fat },
    ],
  };
}

export default function LogEntryRow({
  entry,
  onDelete,
  onEdit,
  onCopyMeal,
  variant = 'inline',
}) {
  const m = computeEntryMacros(entry);
  // Which panel is open: null (collapsed), 'macros', or 'micros'.
  const [view, setView] = useState(null);
  // Direction of the last panel switch — drives the slide-in ('right' when
  // moving Macros→Micros, 'left' coming back, null on a first open).
  const [slide, setSlide] = useState(null);
  const expanded = view != null;
  // Latch: mount the (heavy) Recharts wheel on first open, then keep it mounted.
  // The lightweight breakdown table renders eagerly so its reveal can replay on
  // every open (an element must exist in the closed state to transition from it).
  const [everOpened, setEverOpened] = useState(false);
  // Bumped each time we open. Used as the chart's key so Recharts remounts and
  // replays its entry animation on every open — not just the first mount.
  const [openCycle, setOpenCycle] = useState(0);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const openView = next => {
    if (next === 'macros' && view !== 'macros') { setEverOpened(true); setOpenCycle(c => c + 1); }
    setSlide(
      next === 'micros' && view === 'macros' ? 'right'
      : next === 'macros' && view === 'micros' ? 'left'
      : null
    );
    setView(next);
  };
  const pie = buildPieData(entry);
  const { macroUnits } = useMacroUnits();
  const ingredientRows = parseLoggedIngredients(entry);
  const hasBreakdown = !!ingredientRows;
  const hasMicros = !!parseMicros(entry);

  if (variant === 'dashboard') {
    return (
      <div style={{ padding: 'clamp(16px, 1.6vw, 22px) clamp(20px, 1.8vw, 28px)' }}>
        {/* Row 1: meal name (up to 2 lines) + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div className="meal-name" style={{ flex: 1, minWidth: 0 }}>
            {entry.recipe_name}
          </div>

          {/* Actions — always top-right (panels open via ⋯ menu) */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
            {expanded && (
              <button
                type="button"
                className="btn-secondary meal-row-menu-btn meal-row-collapse-btn"
                aria-label="Collapse meal details"
                title="Collapse"
                onClick={() => setView(null)}
              >
                <svg
                  className="meal-row-collapse-icon"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M2.2 7.8 L6 4 L9.8 7.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <MealRowMenu
              onMacros={() => openView('macros')}
              onMicros={hasMicros ? () => openView('micros') : null}
              onCopyMeal={onCopyMeal ? () => onCopyMeal(entry) : null}
              onDelete={onDelete ? () => onDelete(entry) : null}
            />
          </div>
        </div>

        {/* Row 2: macro summary — full width, single line, never wraps */}
        <div className="meal-macros">
          <span className="meal-cal">{Math.round(m.calories)} cal</span>
          <span className="meal-macro">
            <span style={{ color: MACRO_COLORS.protein, fontWeight: 600 }}>P</span> {formatMacroMass(m.protein_g, macroUnits)}
          </span>
          <span className="meal-macro">
            <span style={{ color: MACRO_COLORS.carbs, fontWeight: 600 }}>C</span> {formatMacroMass(m.carbs_g, macroUnits)}
          </span>
          <span className="meal-macro">
            <span style={{ color: MACRO_COLORS.fat, fontWeight: 600 }}>F</span> {formatMacroMass(m.fat_g, macroUnits)}
          </span>
        </div>

        {/* Row 3: notes (only when present) — kept off the macro line */}
        {entry.notes && <div className="meal-notes">{entry.notes}</div>}

        <div className={`collapse${expanded ? ' is-open' : ''}`}>
          <div className="collapse__inner">
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-divider)' }}>
              {/* Macros panel — display-toggled, not unmounted, so the
                  breakdown's stagger keeps a closed state to animate from. */}
              <div
                style={{ display: view === 'micros' ? 'none' : undefined }}
                className={view === 'macros' && slide === 'left' ? 'meal-panel-left' : ''}
              >
              {hasBreakdown && (
                <div style={{ marginBottom: 18 }}>
                  <IngredientBreakdown rows={ingredientRows} servings={entry.servings} macroUnits={macroUnits} open={view === 'macros'} />
                </div>
              )}
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                Calorie share by macro
              </p>
              {pie.total <= 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-faint)' }}>
                  Not enough macro data to chart this meal.
                </p>
              ) : everOpened ? (
                <ResponsiveContainer width="100%" height={200}>
                  {/* key bumps each open → remount → the wheel replays its
                      animation. It begins ~180ms in so the first rows lead,
                      without waiting for the whole list to finish. */}
                  <PieChart key={openCycle}>
                    <Pie
                      data={pie.rows}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={76}
                      paddingAngle={2}
                      isAnimationActive={!reduceMotion}
                      animationBegin={180}
                      animationDuration={250}
                    >
                      {pie.rows.map((row, i) => (
                        <Cell key={i} fill={row.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${Math.round(value)} kcal`, name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
              </div>

              {/* Micros panel — remounts on each visit so its bars refill. */}
              {view === 'micros' && (
                <div className={slide === 'right' ? 'meal-panel-right' : ''}>
                  <MealMicrosPanel entry={entry} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Inline variant (History page, etc.)
  return (
    <div style={{ borderBottom: '1px solid var(--color-divider)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{entry.recipe_name}</strong>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13, marginLeft: 8 }}>
            {entry.servings}x {entry.serving_size}
          </span>
          {entry.notes && (
            <span style={{ color: 'var(--color-text-faint)', fontSize: 12, marginLeft: 8 }}>· {entry.notes}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><strong>{Math.round(m.calories)}</strong> cal</span>
          <span>P: {formatMacroMass(m.protein_g, macroUnits)}</span>
          <span>C: {formatMacroMass(m.carbs_g, macroUnits)}</span>
          <span>F: {formatMacroMass(m.fat_g, macroUnits)}</span>
        </div>
        {(hasBreakdown || hasMicros) && (
          <ViewToggle view={view} setView={openView} hasMicros={hasMicros} compact />
        )}
        {onEdit && (
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => onEdit(entry)}
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            className="btn-danger"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => onDelete(entry)}
          >
            ✕
          </button>
        )}
      </div>
      {(hasBreakdown || hasMicros) && (
        <div className={`collapse${expanded ? ' is-open' : ''}`}>
          <div className="collapse__inner">
            <div style={{ padding: '2px 0 12px' }}>
              <div
                style={{ display: view === 'micros' ? 'none' : undefined }}
                className={view === 'macros' && slide === 'left' ? 'meal-panel-left' : ''}
              >
                {hasBreakdown ? (
                  <IngredientBreakdown rows={ingredientRows} servings={entry.servings} macroUnits={macroUnits} open={view === 'macros'} />
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>No ingredient breakdown for this meal.</p>
                )}
              </div>
              {view === 'micros' && (
                <div className={slide === 'right' ? 'meal-panel-right' : ''}>
                  <MealMicrosPanel entry={entry} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
