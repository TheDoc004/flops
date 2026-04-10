import { useEffect, useRef, useState } from 'react';
import { fetchRecipes } from '../api/recipes';

export default function LogMealModal({ onLog, onClose }) {
  const ref = useRef(null);
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRecipes().then(setRecipes).catch(() => setError('Failed to load recipes'));
    ref.current?.showModal();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!recipeId) return setError('Select a recipe');
    setError('');
    try {
      await onLog({ recipe_id: Number(recipeId), servings: Number(servings), notes: notes.trim() || undefined });
      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  function close() { ref.current?.close(); onClose(); }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Log a Meal</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Recipe</label>
          <select value={recipeId} onChange={e => setRecipeId(e.target.value)} required>
            <option value="">— Select a recipe —</option>
            {recipes.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.serving_size})</option>
            ))}
          </select>
        </div>
        <div>
          <label>Servings</label>
          <input type="number" min="0.25" step="0.25" value={servings} onChange={e => setServings(e.target.value)} required />
        </div>
        <div>
          <label>Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. post-workout" />
        </div>
        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary">Log Meal</button>
        </div>
      </form>
    </dialog>
  );
}
