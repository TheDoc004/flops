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
    <dialog ref={ref} onClose={onClose} style={{ width: 'min(420px, 94vw)' }}>
      <form onSubmit={handleSave}>
        <h2 className="section-title" style={{ margin: '0 0 4px' }}>
          {asMealPrep ? 'Save as Meal Prep' : 'Save as Recipe'}
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {asMealPrep
            ? `Splits this meal into ${prepServings} limited uses you can log until the batch is gone.`
            : lineCount > 0
              ? `Keeps this meal's ${lineCount} ingredient${lineCount === 1 ? '' : 's'} as a recipe you can log again and edit later.`
              : "Keeps this meal's macros as a recipe you can log again."}
        </p>

        <label htmlFor="save-meal-recipe-name" style={{ fontSize: 15, fontWeight: 600 }}>
          What do you want to name {asMealPrep ? 'this meal prep' : 'this recipe'}?
        </label>
        <input
          id="save-meal-recipe-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={asMealPrep ? 'e.g. Chicken rice prep' : 'e.g. Oat bowl v2'}
          autoFocus
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={asMealPrep}
            onChange={e => setAsMealPrep(e.target.checked)}
          />
          This is a meal prep
        </label>

        {asMealPrep && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  type="button"
                  className={prepServings === n ? 'prep-split is-selected' : 'prep-split'}
                  onClick={() => setPrepServings(n)}
                  style={{ flex: '1 1 auto', minWidth: 72, justifyContent: 'center' }}
                >
                  <span className="prep-split__count">÷ {n}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <label htmlFor="save-meal-prep-count" style={{ margin: 0, fontSize: 13 }}>Custom:</label>
              <input
                id="save-meal-prep-count"
                type="number"
                min="2"
                max="50"
                step="1"
                value={prepServings}
                onChange={e => {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isInteger(v) && v >= 2 && v <= 50) setPrepServings(v);
                }}
                style={{ width: 90 }}
              />
            </div>
          </div>
        )}

        {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
