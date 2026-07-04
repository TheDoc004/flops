import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchProfile, saveProfile } from '@shared/api/profile';
import { fetchRecipes } from '@shared/api/recipes';
import {
  addSavedFuelRecipe,
  deleteSavedFuelRecipe,
  fetchSavedFuelRecipes,
} from '@shared/api/training';
import RecipeCombobox from '@shared/ui/RecipeCombobox';
import Reveal from '@shared/ui/Reveal';

export default function Training() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fuelSaved, setFuelSaved] = useState(false);
  // Guard: prevents auto-save from firing during initial data load
  const fuelInteracted = useRef(false);

  const [prefs, setPrefs] = useState({
    dash_training_fuel_enabled: true,
    digestion_pref: 'none',
    training_goal: 'performance',
  });

  const [recipes, setRecipes] = useState([]);
  const [savedOptions, setSavedOptions] = useState([]);
  const [newRecipeId, setNewRecipeId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const selectedNewRecipe = useMemo(
    () => recipes.find(r => String(r.id) === String(newRecipeId)) || null,
    [recipes, newRecipeId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, rec, opts] = await Promise.all([
          fetchProfile(),
          fetchRecipes(),
          fetchSavedFuelRecipes(),
        ]);
        if (cancelled) return;

        setPrefs({
          dash_training_fuel_enabled: p.dash_training_fuel_enabled !== 0 && p.dash_training_fuel_enabled !== false,
          digestion_pref: p.digestion_pref || 'none',
          training_goal: p.training_goal || 'performance',
        });

        setRecipes(rec || []);
        setSavedOptions(opts || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save whenever any fuel pref changes. fuelInteracted guard
  // prevents a spurious save during the initial data load.
  useEffect(() => {
    if (!fuelInteracted.current) return;
    let cancelled = false;
    setError('');
    setFuelSaved(false);
    saveProfile({
      dash_training_fuel_enabled: prefs.dash_training_fuel_enabled ? 1 : 0,
      digestion_pref: prefs.digestion_pref,
      training_goal: prefs.training_goal,
    }).then(() => {
      if (!cancelled) {
        setFuelSaved(true);
        setTimeout(() => { if (!cancelled) setFuelSaved(false); }, 2000);
      }
    }).catch(err => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, [prefs.dash_training_fuel_enabled, prefs.digestion_pref, prefs.training_goal]);

  async function handleAddSavedOption(e) {
    e.preventDefault();
    setError('');
    const id = Number(newRecipeId);
    if (!Number.isInteger(id) || id <= 0) return setError('Pick a recipe to save.');
    try {
      await addSavedFuelRecipe(id, newLabel.trim() || undefined);
      setSavedOptions(await fetchSavedFuelRecipes());
      setNewRecipeId('');
      setNewLabel('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteSavedOption(recipeId) {
    setError('');
    try {
      await deleteSavedFuelRecipe(recipeId);
      setSavedOptions(await fetchSavedFuelRecipes());
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;

  const H3 = ({ children }) => (
    <h3 className="section-title" style={{ marginBottom: 12 }}>{children}</h3>
  );

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ marginBottom: 6 }}>Fuel settings</h1>
        <p className="page-subtitle">
          Tune digestion preferences and Dashboard quick-log shortcuts.
        </p>
      </Reveal>

      {error && <p className="error">{error}</p>}

      <div className="settings-grid">
        {/* ── Training fuel preferences ── */}
        <Reveal delay={60} className="card">
          <H3>Training fuel</H3>

          {/* Dashboard toggle — pill style, width:auto fixes the global input { width:100% } rule */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
            padding: '8px 10px', marginBottom: 12, borderRadius: 9,
            border: `1px solid ${prefs.dash_training_fuel_enabled ? '#c4b5fd' : 'var(--color-surface-border)'}`,
            background: prefs.dash_training_fuel_enabled ? '#f5f3ff' : 'transparent',
            transition: 'border-color 0.12s, background 0.12s',
          }}>
            <input
              type="checkbox"
              checked={prefs.dash_training_fuel_enabled}
              onChange={e => {
                fuelInteracted.current = true;
                setPrefs(p => ({ ...p, dash_training_fuel_enabled: e.target.checked }));
              }}
              style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-body)', lineHeight: 1.3 }}>
                Show training context &amp; fuel check
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>
                Visible on Dashboard
              </div>
            </div>
          </label>

          <div style={{ marginBottom: 10 }}>
            <label style={{ marginBottom: 4 }}>Digestion preference</label>
            <select
              value={prefs.digestion_pref}
              onChange={e => {
                fuelInteracted.current = true;
                setPrefs(p => ({ ...p, digestion_pref: e.target.value }));
              }}
            >
              <option value="none">No strong preference</option>
              <option value="lower_fat">Prefer lower fat pre-workout</option>
              <option value="lower_fiber">Prefer lower fiber pre-workout</option>
              <option value="sensitive">Sensitive stomach</option>
            </select>
          </div>

          <div>
            <label style={{ marginBottom: 4 }}>Training goal</label>
            <select
              value={prefs.training_goal}
              onChange={e => {
                fuelInteracted.current = true;
                setPrefs(p => ({ ...p, training_goal: e.target.value }));
              }}
            >
              <option value="performance">Performance / feel good</option>
              <option value="fat_loss">Fat loss</option>
              <option value="muscle_gain">Muscle gain</option>
            </select>
          </div>

          {fuelSaved && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--color-success)' }}>Saved.</p>
          )}
        </Reveal>

        {/* ── Saved quick-log fuel options ── */}
        <Reveal delay={120} className="card">
          <H3>Saved fuel options</H3>
          <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Quick-log buttons on the Dashboard.
          </p>

          <form onSubmit={handleAddSavedOption} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <div>
              <RecipeCombobox
                label="Recipe"
                recipes={recipes}
                value={newRecipeId}
                onChange={(next) => setNewRecipeId(next)}
                placeholder="Search recipe or meal…"
              />
              {selectedNewRecipe && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <strong style={{ color: 'var(--color-text-strong)' }}>{selectedNewRecipe.name}</strong>
                  {' · '}{selectedNewRecipe.serving_size}
                </p>
              )}
            </div>
            <div>
              <label style={{ marginBottom: 4 }}>Button label (optional)</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Pre-run snack" />
            </div>
            <div>
              <button type="submit" className="btn-secondary">Add</button>
            </div>
          </form>

          {savedOptions.length === 0 ? (
            <p className="empty-state" style={{ padding: 12 }}>No saved options yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedOptions.map((o, idx) => (
                <Reveal key={o.recipe_id} delay={Math.min(idx, 6) * 60} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  alignItems: 'center', padding: '8px 0',
                  borderBottom: '1px solid #f0ede8',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-primary-ink)' }}>{o.label || o.name}</div>
                    <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>{o.name} · {o.serving_size}</div>
                  </div>
                  <button
                    type="button" className="btn-danger"
                    style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0 }}
                    onClick={() => handleDeleteSavedOption(o.recipe_id)}
                  >
                    Remove
                  </button>
                </Reveal>
              ))}
            </div>
          )}
        </Reveal>
      </div>
    </div>
  );
}
