import { useState } from 'react';
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
import { mealEmoji } from './mealEmoji';
import { parseMicros } from '@shared/utils/microNutrients';

const PIE_COLORS = { protein: MACRO_COLORS.protein, carbs: MACRO_COLORS.carbs, fat: MACRO_COLORS.fat };

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

export default function LogEntryRow({ entry, onDelete, onEdit, variant = 'inline' }) {
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
  const emoji = mealEmoji(entry.recipe_name, ingredientRows ? ingredientRows.map(r => r.name) : []);
  const hasMicros = !!parseMicros(entry);

  if (variant === 'dashboard') {
    return (
      <div style={{ padding: 'clamp(16px, 1.6vw, 22px) clamp(20px, 1.8vw, 28px)' }}>
        {/* Row 1: meal name (up to 2 lines) + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div className="meal-name" style={{ flex: 1, minWidth: 0 }}>
            <span className="meal-emoji" aria-hidden="true">{emoji}</span>
            {entry.recipe_name}
          </div>

          {/* Actions — always top-right */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <ViewToggle view={view} setView={openView} hasMicros={hasMicros} />
            {onDelete && (
              <button
                className="btn-danger"
                style={{ padding: '6px clamp(10px, 1vw, 12px)', fontSize: 'clamp(12px, 0.9vw, 13px)', minHeight: 'clamp(32px, 2.4vw, 38px)', lineHeight: 1 }}
                onClick={() => onDelete(entry)}
                title="Remove entry"
              >
                ✕
              </button>
            )}
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
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f6' }}>
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
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b7280' }}>
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
                      animationDuration={800}
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
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="meal-emoji" aria-hidden="true">{emoji}</span>
          <strong>{entry.recipe_name}</strong>
          <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>
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
