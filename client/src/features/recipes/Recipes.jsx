import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeRow from './RecipeRow';
import LibrarySubNav from '@shared/ui/LibrarySubNav';
import { LogMealModal } from '@features/meal-logging';
import { fetchRecipes, deleteRecipe, reactivateLimitedRecipe } from '@shared/api/recipes';
import { createLogEntry } from '@shared/api/log';
import { filterRecipesByName } from '@shared/utils/recipeSearch';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import usePaginationAnchor from '@shared/hooks/usePaginationAnchor';
import Reveal from '@shared/ui/Reveal';
import GrowStack from '@shared/ui/GrowStack';
import { isIngredientBuilt } from '@features/ai-macro-logger';

export default function Recipes() {
  const navigate = useNavigate();
  const location = useLocation();
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
  // Which side new rows slide in from — follows the flip direction, like a book.
  const [slideFrom, setSlideFrom] = useState('right');
  // Height floor for the list area, captured on every flip: a shorter page
  // (especially the last one) must not shrink the card and pull the pagination
  // buttons up mid-click — short pages get white space instead.
  const listRef = useRef(null);
  const [listMinHeight, setListMinHeight] = useState(0);
  const flipPage = next => {
    const h = listRef.current?.offsetHeight || 0;
    setListMinHeight(prev => Math.max(prev, h));
    setSlideFrom(next > page ? 'right' : 'left');
    handlePageChange(next);
  };
  // A different result set has different natural heights — release the floor.
  useEffect(() => { setListMinHeight(0); }, [search, includeArchived, pageSize]);

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
      <LibrarySubNav />

      <Reveal style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title">Recipe Library</h1>
        {/* Meal Builder lives here now, so this button IS the way in — sized to
            match, not tucked away as a header afterthought. */}
        <button
          className="btn-primary"
          onClick={() => navigate('/meal-builder')}
          title="Build a recipe in Meal Builder"
          style={{ minHeight: 48, padding: '0 20px', fontSize: 15.5, fontWeight: 700, flexShrink: 0 }}
        >
          + Build a meal
        </button>
      </Reveal>

      {error && <p className="error">{error}</p>}
      {logSaved && (
        <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--color-success)', fontSize: 14 }}>
          {logSaved}
        </p>
      )}

      <Reveal delay={60} style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Building and editing both happen in Meal Builder — “Build a meal” to start a new one, “Edit” on any recipe below.
      </Reveal>

      <Reveal delay={120} className="card">
        <label htmlFor="recipe-search" style={{ marginBottom: 4 }}>Search by name</label>
        <input
          id="recipe-search"
          type="search"
          placeholder="Type to filter recipes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
          style={{ marginBottom: 10 }}
        />
        {/* Sits under the search box, not above it: finding a recipe is the
            job you came for, and widening the set to finished meal preps is a
            refinement of that search — not a decision to make first. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)' }}>
          <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
          <span>Include finished meal preps &amp; archived templates</span>
        </label>
        {filtered.length === 0 ? (
          <p className="empty-state">{recipes.length === 0 ? 'No recipes yet. Create one in Meal Builder.' : 'No recipes match your search.'}</p>
        ) : (
          <>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-faint)' }}>
              {filtered.length} recipe{filtered.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
            <div
              ref={listRef}
              className="recipe-list"
              style={{ minHeight: listMinHeight || undefined }}
            >
              <GrowStack slideFrom={slideFrom}>
                {paginated.map(recipe => (
                  <RecipeRow
                    key={recipe.id}
                    recipe={recipe}
                    onLog={setLogRecipe}
                    onEditInBuilder={() => navigate(
                      `/meal-builder?mode=${isIngredientBuilt(recipe) ? 'labels' : 'manual'}&recipe_id=${recipe.id}`,
                      // Tell the builder where to send you on "Exit edit" —
                      // including the current filters/page, so you land back
                      // on the list as you left it.
                      { state: { from: `${location.pathname}${location.search}` } }
                    )}
                    onDelete={handleDelete}
                    onReactivate={handleReactivate}
                  />
                ))}
              </GrowStack>
              {totalPages > 1 && paginated.length < pageSize && (
                <div className="ghost-slots">
                  {Array.from({ length: pageSize - paginated.length }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className="ghost-slot"
                      aria-label="Add a recipe in Meal Builder"
                      title="Add a recipe"
                      onClick={() => navigate('/meal-builder')}
                      style={{ '--slide-delay': `${Math.min(paginated.length + i, 8) * 45}ms` }}
                    >
                      +
                    </button>
                  ))}
                </div>
              )}
            </div>
            {totalPages > 1 && (
              <div ref={paginationRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-divider)' }}>
                <button type="button" className="btn-secondary" disabled={currentPage <= 1} onClick={() => flipPage(currentPage - 1)}>Previous</button>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {currentPage} of {totalPages}</span>
                <button type="button" className="btn-secondary" disabled={currentPage >= totalPages} onClick={() => flipPage(currentPage + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </Reveal>

      {logRecipe && (
        <LogMealModal
          title={`Log: ${logRecipe.name}`}
          submitLabel="Log"
          initialEntry={{ recipe_id: logRecipe.id, servings: 1 }}
          onClose={() => setLogRecipe(null)}
          onLog={async (payload) => {
            await createLogEntry({ ...payload, date: getLocalDateISO() });
            setLogRecipe(null);
            navigate(`/recipes?saved=${encodeURIComponent('Logged to today.')}`);
          }}
        />
      )}
    </div>
  );
}
