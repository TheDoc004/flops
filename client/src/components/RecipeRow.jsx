export default function RecipeRow({ recipe, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <strong>{recipe.name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>per {recipe.serving_size}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#374151' }}>
        <span><strong>{recipe.calories}</strong> cal</span>
        <span>P: {recipe.protein_g}g</span>
        <span>C: {recipe.carbs_g}g</span>
        <span>F: {recipe.fat_g}g</span>
        {recipe.fiber_g != null && <span>Fiber: {recipe.fiber_g}g</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" onClick={() => onEdit(recipe)}>Edit</button>
        <button className="btn-danger" onClick={() => onDelete(recipe)}>Delete</button>
      </div>
    </div>
  );
}
