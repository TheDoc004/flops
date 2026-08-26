import { useEffect, useRef, useState } from 'react';
import { createRecipe } from '@shared/api/recipes';
import { buildRecipeFromLogEntry } from './recipeReceipt';

/**
 * "What do you want to name this recipe?" — the one question standing between a
 * meal already in the day and a reusable recipe.
 *
 * The name is prefilled from the meal so keeping it is a single confirm, while
 * still inviting the variant names that make tweaking worthwhile ("Oat bowl v2").
 */
export default function SaveMealAsRecipeDialog({ entry, onClose, onSaved }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(String(entry?.recipe_name || '').trim());
    setError('');
    ref.current?.showModal();
  }, [entry]);

  const lineCount = (() => {
    try {
      const raw = entry?.ingredients_json;
      const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(rows) ? rows.length : 0;
    } catch {
      return 0;
    }
  })();

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    const body = buildRecipeFromLogEntry(entry, name);
    if (!body) {
      setError('Give the recipe a name.');
      return;
    }
    setSaving(true);
    try {
      const created = await createRecipe(body);
      onSaved?.(created, body.name);
      ref.current?.close();
    } catch (err) {
      setError(err.message || 'Could not save the recipe.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} style={{ width: 'min(420px, 94vw)' }}>
      <form onSubmit={handleSave}>
        <h2 className="section-title" style={{ margin: '0 0 4px' }}>Save as Recipe</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {lineCount > 0
            ? `Keeps this meal's ${lineCount} ingredient${lineCount === 1 ? '' : 's'} as a recipe you can log again and edit later.`
            : "Keeps this meal's macros as a recipe you can log again."}
        </p>

        <label htmlFor="save-meal-recipe-name" style={{ fontSize: 15, fontWeight: 600 }}>
          What do you want to name this recipe?
        </label>
        <input
          id="save-meal-recipe-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Oat bowl v2"
          autoFocus
        />

        {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="submit"
            className={saving ? 'btn-primary btn-loading' : 'btn-primary'}
            disabled={saving}
          >
            {saving ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : 'Save recipe'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={saving}
            onClick={() => ref.current?.close()}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
