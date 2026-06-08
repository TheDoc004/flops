/**
 * Client-side recipe name search: case-insensitive partial match, sorted by relevance then A–Z.
 * @param {Array<{ id: unknown, name: string }>} recipes
 * @param {string} query
 * @returns {typeof recipes}
 */
export function filterRecipesByName(recipes, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(recipes) ? recipes : [];
  if (!q) {
    return [...list].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
    );
  }
  const matches = list.filter(r => String(r.name).toLowerCase().includes(q));
  function rank(name) {
    const n = String(name).toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  }
  return matches.sort((a, b) => {
    const ra = rank(a.name);
    const rb = rank(b.name);
    if (ra !== rb) return ra - rb;
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
  });
}

/**
 * Options for a picker: filtered list, but keep the currently selected recipe visible even if it doesn't match the filter.
 * @param {Array<{ id: unknown, name: string }>} allRecipes
 * @param {string} query
 * @param {string|number|null|undefined} selectedId
 */
export function recipesForSelectPicker(allRecipes, query, selectedId) {
  const filtered = filterRecipesByName(allRecipes, query);
  if (selectedId == null || selectedId === '') return filtered;
  const sel = allRecipes.find(r => String(r.id) === String(selectedId));
  if (!sel) return filtered;
  if (filtered.some(r => String(r.id) === String(sel.id))) return filtered;
  return [sel, ...filtered];
}
