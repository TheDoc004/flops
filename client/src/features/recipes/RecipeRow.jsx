import { useState } from 'react';
import { fetchRecipeNutrition } from '@shared/api/recipes';
import { ViewToggle, MealMicrosPanel, IngredientBreakdown } from '@features/meal-logging';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import { formatMacroMass } from '@shared/utils/macroUnits';

/**
 * One recipe in the library.
 *
 * Expands exactly like a logged meal on Today: the same Macros | Micros toggle,
 * the same ingredient breakdown table, the same micro panel. The only
 * difference is what the numbers describe — a recipe's default amounts rather
 * than something you actually ate — which the panels say in their captions.
 */
export default function RecipeRow({ recipe, onLog, onEditInBuilder, onDelete, onReactivate }) {
  const limited = (recipe.recipe_kind || 'permanent') === 'limited';
  const archived = recipe.is_archived === 1 || recipe.is_archived === true;
  const hasMealBuilderMeta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object';
  const { macroUnits } = useMacroUnits();

  // null | 'macros' | 'micros'. Detail is fetched on first open and kept.
  const [view, setView] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  async function openView(next) {
    setView(next);
    if (next == null || detail || loading) return;
    setLoading(true);
    setDetailError('');
    try {
      setDetail(await fetchRecipeNutrition(recipe.id));
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Micros ride in on a synthetic entry so the panel is the identical component
  // the meal row uses — one serving, since a recipe IS its serving.
  const microEntry = detail?.micros
    ? { servings: 1, micros_json: JSON.stringify(detail.micros) }
    : { servings: 1, micros_json: null };
  // Before the first fetch we can't know whether micros exist; leaving the
  // button live is what lets you press it to find out.
  const hasMicros = detail ? !!detail.micros : true;

  return (
    <div className={view ? 'recipe-card is-open' : 'recipe-card'}>
      <div className="recipe-card-top">
        <div className="recipe-card-main">
          <div className="recipe-card-head">
            <strong className="recipe-card-name name-uniform">{recipe.name}</strong>
            {limited && (() => {
              // Meal preps saved from the AI logger carry a meta marker; the
              // serving_size check catches preps saved before the marker existed.
              const isPrep = recipe.meal_builder_meta?.source === 'ai_meal_prep'
                || /meal-prep/i.test(recipe.serving_size || '');
              const label = isPrep
                ? (archived ? '🍱 Meal prep · finished' : `🍱 Meal prep · ${recipe.remaining_uses ?? '—'} left`)
                : (archived ? 'Template · archived' : `Template · ${recipe.remaining_uses ?? '—'} left`);
              const tint = archived
                ? { color: 'var(--color-text-faint)', background: 'var(--color-divider)' }
                : isPrep
                  ? { color: 'var(--color-primary-ink)', background: 'var(--color-primary-subtle)' }
                  : { color: '#b45309', background: '#fffbeb' };
              return (
                <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, ...tint }}>
                  {label}
                </span>
              );
            })()}
          </div>
          <ViewToggle
            view={view}
            setView={openView}
            hasMicros={hasMicros}
            compact
            macrosTitle="Ingredients and macro breakdown"
            microsTitle="Micronutrients in this recipe"
          />
        </div>

        <div className="recipe-card-macros">
          <span><strong>{recipe.calories}</strong> cal</span>
          <span>P: {recipe.protein_g}g</span>
          <span>C: {recipe.carbs_g}g</span>
          <span>F: {recipe.fat_g}g</span>
          {recipe.fiber_g != null && <span>Fiber: {recipe.fiber_g}g</span>}
        </div>

        <div className="recipe-card-actions">
          {limited && archived && onReactivate && (
            <button type="button" className="btn-secondary" onClick={() => onReactivate(recipe)}>Reactivate</button>
          )}
          {onLog && <button className="btn-secondary" onClick={() => onLog(recipe)}>Log</button>}
          {onEditInBuilder && (
            <button className="btn-secondary" onClick={() => onEditInBuilder(recipe)}>
              {hasMealBuilderMeta ? 'Edit in Meal Builder' : 'Edit'}
            </button>
          )}
          <button className="btn-danger" onClick={() => onDelete(recipe)}>Delete</button>
        </div>
      </div>

      {view && (
        <div className="recipe-card-detail panel-in">
          {loading && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Working out the nutrition…</p>}
          {detailError && <p className="error" style={{ margin: 0 }}>{detailError}</p>}

          {detail && !loading && !detail.ingredientsKnown && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              This recipe has no itemized ingredients, so there’s nothing to break down.
            </p>
          )}

          {detail && !loading && detail.ingredientsKnown && view === 'macros' && (
            <>
              <p className="recipe-card-detail__caveat">For this recipe’s default ingredient amounts.</p>
              <IngredientBreakdown rows={detail.rows} servings={1} macroUnits={macroUnits} open />
              {detail.macros && (
                <div className="recipe-card-detail__total">
                  <strong>Total</strong> {Math.round(detail.macros.calories)} cal ·
                  {' '}P {formatMacroMass(detail.macros.protein_g, macroUnits)} ·
                  {' '}C {formatMacroMass(detail.macros.carbs_g, macroUnits)} ·
                  {' '}F {formatMacroMass(detail.macros.fat_g, macroUnits)}
                  {detail.macros.fiber_g > 0 ? ` · Fiber ${formatMacroMass(detail.macros.fiber_g, macroUnits)}` : ''}
                </div>
              )}
            </>
          )}

          {detail && !loading && detail.ingredientsKnown && view === 'micros' && (
            <MealMicrosPanel
              entry={microEntry}
              caption="How much of your daily targets this recipe covers, at its default amounts"
              emptyNote="No micronutrient estimate for this recipe yet."
            />
          )}
        </div>
      )}
    </div>
  );
}
