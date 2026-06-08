export default function RecipeRow({ recipe, onLog, onEditInBuilder, onDelete, onReactivate }) {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const hasVariableSlots = ingredients.some(ing => ing && ing.kind === 'slot');
  const kind = recipe.recipe_kind || 'permanent';
  const limited = kind === 'limited';
  const archived = recipe.is_archived === 1 || recipe.is_archived === true;
  const hasMealBuilderMeta = recipe.meal_builder_meta && typeof recipe.meal_builder_meta === 'object';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <strong>{recipe.name}</strong>
        {hasVariableSlots && (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: 999 }}>
            Variable ingredients
          </span>
        )}
        {limited && (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: archived ? '#9ca3af' : '#b45309', background: archived ? '#f3f4f6' : '#fffbeb', padding: '2px 8px', borderRadius: 999 }}>
            {archived ? 'Template · archived' : `Template · ${recipe.remaining_uses ?? '—'} left`}
          </span>
        )}
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>per {recipe.serving_size}</span>
        {ingredients.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#374151' }}>
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
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#374151' }}>
        <span><strong>{recipe.calories}</strong> cal</span>
        <span>P: {recipe.protein_g}g</span>
        <span>C: {recipe.carbs_g}g</span>
        <span>F: {recipe.fat_g}g</span>
        {recipe.fiber_g != null && <span>Fiber: {recipe.fiber_g}g</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
