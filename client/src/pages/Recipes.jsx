import { useEffect, useState } from 'react';
import RecipeForm from '../components/RecipeForm';
import RecipeRow from '../components/RecipeRow';
import { fetchRecipes, createRecipe, updateRecipe, deleteRecipe } from '../api/recipes';

export default function Recipes() {
  const [recipes, setRecipes] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try { setRecipes(await fetchRecipes()); }
    catch (e) { setError(e.message); }
  }

  async function handleAdd(data) {
    await createRecipe(data);
    setShowAdd(false);
    load();
  }

  async function handleEdit(data) {
    await updateRecipe(editing.id, data);
    setEditing(null);
    load();
  }

  async function handleDelete(recipe) {
    try { await deleteRecipe(recipe.id); load(); }
    catch (e) { setError(e.message); }
  }

  const filtered = recipes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Recipe Library</h1>
        <button className="btn-primary" onClick={() => { setShowAdd(true); setEditing(null); }}>+ Add Recipe</button>
      </div>

      {error && <p className="error">{error}</p>}

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>New Recipe</h3>
          <RecipeForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Add Recipe" />
        </div>
      )}

      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Edit Recipe</h3>
          <RecipeForm
            initial={{ ...editing, fiber_g: editing.fiber_g ?? '' }}
            onSubmit={handleEdit}
            onCancel={() => setEditing(null)}
            submitLabel="Save Changes"
          />
        </div>
      )}

      <div className="card">
        <input placeholder="Search recipes..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
        {filtered.length === 0
          ? <p className="empty-state">{recipes.length === 0 ? 'No recipes yet. Add your first recipe!' : 'No recipes match your search.'}</p>
          : filtered.map(recipe => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                onEdit={r => { setEditing(r); setShowAdd(false); }}
                onDelete={handleDelete}
              />
            ))
        }
      </div>
    </div>
  );
}
