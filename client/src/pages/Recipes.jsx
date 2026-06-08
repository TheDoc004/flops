import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeRow from '../components/RecipeRow';
import LogMealModal from '../components/LogMealModal';
import { fetchRecipes, deleteRecipe, reactivateLimitedRecipe } from '../api/recipes';
import { createLogEntry, createQuickFoodLog } from '../api/log';
import { filterRecipesByName } from '../utils/recipeSearch';
import { getLocalDateISO } from '../utils/dateLocal';

export default function Recipes() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [recipes, setRecipes] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [logRecipe, setLogRecipe] = useState(null);
  const [logSaved, setLogSaved] = useState('');

  useEffect(() => { void load(); }, [includeArchived]);
  useEffect(() => {
    const msg = searchParams.get('saved');
    if (msg) setLogSaved(msg);
  }, [searchParams]);

  async function load() {
    try { setRecipes(await fetchRecipes({ includeArchived })); }
    catch (e) { setError(e.message); }
  }

  async function handleDelete(recipe) {
    try { await deleteRecipe(recipe.id); load(); }
    catch (e) { setError(e.message); }
  }

  async function handleReactivate(recipe) {
    const raw = window.prompt('New number of uses (1–999):', String(recipe.max_uses || 5));
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      setError('Invalid uses.');
      return;
    }
    setError('');
    try {
      await reactivateLimitedRecipe(recipe.id, n);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const filtered = useMemo(() => filterRecipesByName(recipes, search), [recipes, search]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{
          margin: 0, fontSize: 32, fontWeight: 400,
          color: '#1e1b4b', letterSpacing: '-0.02em', lineHeight: 1.1,
          fontFamily: "'DM Serif Display', Georgia, serif",
        }}>Recipe Library</h1>
        <button
          className="btn-primary"
          onClick={() => navigate('/meal-builder?mode=manual')}
          title="Create recipes in Meal Builder"
        >
          + Add Recipe
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {logSaved && (
        <p style={{ marginTop: 0, marginBottom: 12, color: '#059669', fontSize: 14 }}>
          {logSaved}
        </p>
      )}

      <div style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
        Create and edit recipes in <Link to="/meal-builder" style={{ color: '#2563eb' }}>Meal Builder</Link>. Use this library to browse, search, view, and log.
      </div>

      <div className="card">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
          <span>Show archived limited-use templates</span>
        </label>
        <label htmlFor="recipe-search" style={{ marginBottom: 4 }}>Search by name</label>
        <input
          id="recipe-search"
          type="search"
          placeholder="Type to filter recipes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
          style={{ marginBottom: 12 }}
        />
        {filtered.length === 0
          ? <p className="empty-state">{recipes.length === 0 ? 'No recipes yet. Create one in Meal Builder.' : 'No recipes match your search.'}</p>
          : filtered.map(recipe => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                onLog={setLogRecipe}
                onEditInBuilder={() => navigate(`/meal-builder?mode=${recipe.meal_builder_meta?.source === 'meal_builder' ? 'labels' : 'manual'}&recipe_id=${recipe.id}`)}
                onDelete={handleDelete}
                onReactivate={handleReactivate}
              />
            ))
        }
      </div>

      {logRecipe && (
        <LogMealModal
          title={`Log: ${logRecipe.name}`}
          submitLabel="Log"
          initialEntry={{ recipe_id: logRecipe.id, servings: 1 }}
          onClose={() => setLogRecipe(null)}
          onLog={async (payload) => {
            const today = getLocalDateISO();
            if (payload?.quick_food) {
              await createQuickFoodLog({
                date: today,
                ...payload.quick_food,
                notes: payload.notes,
                time_min: payload.time_min,
              });
            } else {
              await createLogEntry({ ...payload, date: today });
            }
            setLogRecipe(null);
            navigate(`/recipes?saved=${encodeURIComponent('Logged to today.')}`);
          }}
        />
      )}
    </div>
  );
}
