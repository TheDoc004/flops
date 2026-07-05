export default function RecipeRow({ recipe, onLog, onEditInBuilder, onDelete, onReactivate }) {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const hasVariableSlots = ingredients.some(ing => ing && ing.kind === 'slot');
  const kind = recipe.recipe_kind || 'permanent';
  const limited = kind === 'limited';
  const archived = recipe.is_archived === 1 || recipe.is_archived === true;
  const hasMealBuilderMeta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object';

  return (
    <div className="recipe-card">
      <div className="recipe-card-main">
        <div className="recipe-card-head">
          <strong className="recipe-card-name">{recipe.name}</strong>
          {hasVariableSlots && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-link)', background: '#dbeafe', padding: '2px 8px', borderRadius: 999 }}>
              Variable ingredients
            </span>
          )}
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
                ? { color: '#5b21b6', background: '#f3efff' }
                : { color: '#b45309', background: '#fffbeb' };
            return (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, ...tint }}>
                {label}
              </span>
            );
          })()}
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>per {recipe.serving_size}</span>
        </div>
        {ingredients.length > 0 && (
          <ul className="recipe-card-ingredients">
            {ingredients.map((ing, i) => (
              <li key={i}>
                {ing.kind === 'slot' ? (
                  <>
                    <em>Slot:</em> {ing.label} — {ing.amount}
                    {ing.unit === 'oz' ? ' oz' : ' g'}
                    {' '}
                    (
                    {(() => {
                      const n = ing.option_label_ingredient_ids?.length || 0;
                      const subs = Math.max(0, n - 1);
                      if (subs <= 0) return 'default only';
                      return `default + ${subs} substitute${subs === 1 ? '' : 's'}`;
                    })()}
                    )
                  </>
                ) : (
                  <>
                    {ing.name} — {ing.amount}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
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
        {onLog && (
          <button className="btn-secondary" onClick={() => onLog(recipe)}>Log</button>
        )}
        {onEditInBuilder && (
          <button className="btn-secondary" onClick={() => onEditInBuilder(recipe)}>
            {hasMealBuilderMeta ? 'Edit in Meal Builder' : 'Edit'}
          </button>
        )}
        <button className="btn-danger" onClick={() => onDelete(recipe)}>Delete</button>
      </div>
    </div>
  );
}
