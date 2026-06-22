import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeRow from './RecipeRow';
import { LogMealModal } from '@features/meal-logging';
import { fetchRecipes, deleteRecipe, reactivateLimitedRecipe } from '@shared/api/recipes';
import { createLogEntry, createQuickFoodLog, createCustomLog } from '@shared/api/log';
import { filterRecipesByName } from '@shared/utils/recipeSearch';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import usePaginationAnchor from '@shared/hooks/usePaginationAnchor';

export default function Recipes() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [recipes, setRecipes] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [logRecipe, setLogRecipe] = useState(null);
  const [logSaved, setLogSaved] = useState('');

  // Pagination — fewer per page on mobile (recipe cards are tall), more on desktop.
  const isWide = useMediaQuery('(min-width: 700px)');
  const pageSize = isWide ? 10 : 6;
  const { page, setPage, paginationRef, handlePageChange } = usePaginationAnchor();

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  // Reset to page 1 whenever the result set changes (search or archive toggle).
  useEffect(() => { setPage(1); }, [search, includeArchived]);
  // Clamp if the page count shrinks (e.g. viewport resize changes pageSize).
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title">Recipe Library</h1>
        <button
          className="btn-primary"
          onClick={() => navigate('/meal-builder')}
          title="Create recipes in Meal Builder"
        >
          + Add Recipe
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {logSaved && (
        <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--color-success)', fontSize: 14 }}>
          {logSaved}
        </p>
      )}

      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Create and edit recipes in <Link to="/meal-builder" style={{ color: 'var(--color-link)' }}>Meal Builder</Link>. Use this library to browse, search, view, and log.
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
        {filtered.length === 0 ? (
          <p className="empty-state">{recipes.length === 0 ? 'No recipes yet. Create one in Meal Builder.' : 'No recipes match your search.'}</p>
        ) : (
          <>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-faint)' }}>
              {filtered.length} recipe{filtered.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
            <div>
              {paginated.map(recipe => (
                <RecipeRow
                  key={recipe.id}
                  recipe={recipe}
                  onLog={setLogRecipe}
                  onEditInBuilder={() => navigate(`/meal-builder?mode=${recipe.meal_builder_meta?.source === 'meal_builder' ? 'labels' : 'manual'}&recipe_id=${recipe.id}`)}
                  onDelete={handleDelete}
                  onReactivate={handleReactivate}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div ref={paginationRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-divider)' }}>
                <button type="button" className="btn-secondary" disabled={currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)}>Previous</button>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {currentPage} of {totalPages}</span>
                <button type="button" className="btn-secondary" disabled={currentPage >= totalPages} onClick={() => handlePageChange(currentPage + 1)}>Next</button>
              </div>
            )}
          </>
        )}
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
            } else if (payload?.log_custom) {
              await createCustomLog({
                date: today,
                ...payload.log_custom,
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
