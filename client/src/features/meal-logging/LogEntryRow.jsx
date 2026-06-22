import { useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { computeEntryMacros, mealMacroCalorieBreakdown } from '@shared/utils/macros';
import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { MACRO_COLORS } from '@shared/utils/colors';

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
  const [expanded, setExpanded] = useState(false);
  const pie = buildPieData(entry);
  const { macroUnits } = useMacroUnits();

  if (variant === 'dashboard') {
    return (
      <div style={{ padding: '16px 20px' }}>
        {/* Row 1: meal name (up to 2 lines) + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div className="meal-name" style={{ flex: 1, minWidth: 0 }}>
            {entry.recipe_name}
          </div>

          {/* Actions — always top-right */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '5px 10px', minHeight: 32, lineHeight: 1 }}
              onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
              title="Toggle macro breakdown"
            >
              {expanded ? '▲' : '▼'}
            </button>
            {onDelete && (
              <button
                className="btn-danger"
                style={{ padding: '5px 10px', fontSize: 12, minHeight: 32, lineHeight: 1 }}
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

        {expanded && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f6' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b7280' }}>
              Calorie share by macro
            </p>
            {pie.total <= 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: '#9ca3af' }}>
                Not enough macro data to chart this meal.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pie.rows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {pie.rows.map((row, i) => (
                      <Cell key={i} fill={row.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${Math.round(value)} kcal`, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    );
  }

  // Inline variant (History page, etc.)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{entry.recipe_name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>
          {entry.servings}x {entry.serving_size}
        </span>
        {entry.notes && (
          <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>· {entry.notes}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><strong>{Math.round(m.calories)}</strong> cal</span>
        <span>P: {formatMacroMass(m.protein_g, macroUnits)}</span>
        <span>C: {formatMacroMass(m.carbs_g, macroUnits)}</span>
        <span>F: {formatMacroMass(m.fat_g, macroUnits)}</span>
      </div>
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
  );
}
