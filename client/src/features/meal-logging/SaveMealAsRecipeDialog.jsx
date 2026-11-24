import { useEffect, useRef, useState } from 'react';
import { createRecipe } from '@shared/api/recipes';
import { buildRecipeFromLogEntry } from './recipeReceipt';

/**
 * "What do you want to name this recipe?" — the one question standing between a
 * meal already in the day and a reusable recipe. Optional meal-prep checkbox
 * turns it into an equal N-way limited template (custom % lives in Log a Meal).
 */
export default function SaveMealAsRecipeDialog({ entry, onClose, onSaved }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [asMealPrep, setAsMealPrep] = useState(false);
  const [prepServings, setPrepServings] = useState(4);

  useEffect(() => {
    setName(String(entry?.recipe_name || '').trim());
    setError('');
    setAsMealPrep(false);
    setPrepServings(4);
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
    const opts = asMealPrep ? { mealPrepServings: prepServings } : undefined;
    const body = buildRecipeFromLogEntry(entry, name, opts);
    if (!body) {
      setError(asMealPrep
        ? 'Give the meal prep a name and pick at least 2 servings.'
        : 'Give the recipe a name.');
      return;
    }
    setSaving(true);
    try {
      const created = await createRecipe(body);
      const label = asMealPrep ? `${body.name} (${prepServings} servings)` : body.name;
      onSaved?.(created, label);
      ref.current?.close();
    } catch (err) {
      setError(err.message || 'Could not save the recipe.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="save-recipe-dialog">
      <form onSubmit={handleSave}>
        <div className="save-recipe-dialog__header">
          <h2 className="save-recipe-dialog__title">
            {asMealPrep ? 'Save as Meal Prep' : 'Save as Recipe'}
          </h2>
          <button
            type="button"
            className="modal-close-x"
            aria-label="Close"
            onClick={() => ref.current?.close()}
          >
            ✕
          </button>
        </div>

        <p className="save-recipe-dialog__hint">
          {asMealPrep
            ? `Splits this meal into ${prepServings} limited uses you can log until the batch is gone.`
            : lineCount > 0
              ? `Keeps this meal's ${lineCount} ingredient${lineCount === 1 ? '' : 's'} as a recipe you can log again and edit later.`
              : "Keeps this meal's macros as a recipe you can log again."}
        </p>

        <label htmlFor="save-meal-recipe-name" className="save-recipe-dialog__label">
          What do you want to name {asMealPrep ? 'this meal prep' : 'this recipe'}?
        </label>
        <input
          id="save-meal-recipe-name"
          className="save-recipe-dialog__input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={asMealPrep ? 'e.g. Chicken rice prep' : 'e.g. Oat bowl v2'}
          autoFocus
        />

        <label className="save-recipe-dialog__checkbox">
          <input
            type="checkbox"
            checked={asMealPrep}
            onChange={e => setAsMealPrep(e.target.checked)}
          />
          This is a meal prep
        </label>

        {asMealPrep && (
          <div className="save-recipe-dialog__prep">
            <div className="save-recipe-dialog__splits">
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  type="button"
                  className={prepServings === n ? 'prep-split is-selected' : 'prep-split'}
                  onClick={() => setPrepServings(n)}
                >
                  <span className="prep-split__count">÷ {n}</span>
                </button>
              ))}
            </div>
            <div className="save-recipe-dialog__custom">
              <label htmlFor="save-meal-prep-count" className="save-recipe-dialog__custom-label">Custom:</label>
              <input
                id="save-meal-prep-count"
                className="save-recipe-dialog__custom-input"
                type="number" inputMode="numeric"
                min="2"
                max="50"
                step="1"
                value={prepServings}
                onChange={e => {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isInteger(v) && v >= 2 && v <= 50) setPrepServings(v);
                }}
              />
            </div>
          </div>
        )}

        {error && <p className="error save-recipe-dialog__error">{error}</p>}

        <div className="save-recipe-dialog__actions">
          <button
            type="submit"
            className={saving ? 'btn-primary btn-loading' : 'btn-primary'}
            disabled={saving}
          >
            {saving
              ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>)
              : asMealPrep
                ? 'Save meal prep'
                : 'Save recipe'}
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
