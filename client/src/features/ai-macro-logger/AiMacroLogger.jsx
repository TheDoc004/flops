import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { estimateMacros } from '@shared/api/ai';
import { createCustomLog, createLogEntry } from '@shared/api/log';
import { createRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import { macrosForLabelServingAmount } from '@features/label-ocr';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { matchRecipe, recipeReviewRows } from './recipeCommand';

const PLACEHOLDER =
  'Example: 155g cooked turkey, 250g sweet potato, 20 calories BBQ sauce…';

const STATE_LABELS = { raw: 'raw', cooked: 'cooked', unknown: '', not_applicable: '' };

const CONFIDENCE_META = {
  high: { label: 'High confidence', bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46' },
  medium: { label: 'Medium confidence — review carefully', bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
  low: { label: 'Low confidence — review carefully before logging', bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' },
};

const n = v => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

const normName = s => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const isMassUnit = u => /^(g|gram|grams|oz|ounce|ounces)$/.test(String(u || '').toLowerCase());

/**
 * Library macros for an AI-detected amount, ONLY when the AI unit is compatible
 * with the saved ingredient's tracking type — otherwise null so we keep the AI
 * estimate rather than mis-scale (e.g. "2 slices" onto a grams-per-serving item,
 * or "170 g" onto a per-unit item). Returns {calories,protein_g,carbs_g,fat_g}.
 */
function libraryMacrosFor(ing, quantity, unit) {
  const unitTracked = ing.tracking_type === 'unit';
  const mass = isMassUnit(unit);
  if (unitTracked && mass) return null;   // mass amount can't map to a per-unit ingredient
  if (!unitTracked && !mass) return null; // non-mass amount can't map to a grams-per-serving ingredient
  const m = macrosForLabelServingAmount(ing, quantity, mass ? unit : 'unit');
  return m && Number.isFinite(m.calories) ? m : null;
}

/**
 * Prefer saved-library data for AI-detected ingredients matched by name. Matched
 * + unit-compatible rows get library macros and source:'library'; everything
 * else stays source:'ai'. Pure — doesn't mutate the estimate.
 */
function enrichWithLibrary(est, libIndex) {
  if (!est) return est;
  const r1 = x => Math.round(x * 10) / 10;
  const ingredients = est.ingredients.map(ing => {
    const lib = libIndex && libIndex.get(normName(ing.name));
    if (lib) {
      const m = libraryMacrosFor(lib, ing.quantity, ing.unit);
      if (m) {
        return {
          ...ing,
          calories: r1(m.calories), protein: r1(m.protein_g), carbs: r1(m.carbs_g), fat: r1(m.fat_g),
          source: 'library', label_ingredient_id: lib.id, matchedName: lib.name,
        };
      }
    }
    return { ...ing, source: 'ai', label_ingredient_id: undefined, matchedName: undefined };
  });
  return { ...est, ingredients };
}

/** Defensive client-side normalization so a malformed response can't crash the UI. */
function normalizeEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(i => ({
    name: typeof i?.name === 'string' && i.name.trim() ? i.name.trim() : 'Item',
    quantity: Number.isFinite(Number(i?.quantity)) ? Number(i.quantity) : 0,
    unit: typeof i?.unit === 'string' ? i.unit : '',
    state: ['raw', 'cooked', 'unknown', 'not_applicable'].includes(i?.state) ? i.state : 'unknown',
    calories: n(i?.calories),
    protein: n(i?.protein),
    carbs: n(i?.carbs),
    fat: n(i?.fat),
    notes: typeof i?.notes === 'string' ? i.notes : '',
    source: 'ai',
  }));
  return {
    mealName: typeof raw.mealName === 'string' && raw.mealName.trim() ? raw.mealName.trim() : 'Meal',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
    ingredients,
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : []).filter(x => typeof x === 'string'),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).filter(x => typeof x === 'string'),
  };
}

/** Human-readable one-liner for a detected recipe modification (review display). */
function describeModification(m) {
  const t = m?.target ? ` ${m.target}` : '';
  const amt = m?.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : '';
  switch (m?.type) {
    case 'remove': return `Remove${t}`;
    case 'set_amount': return `Set${t}${amt ? ` to ${amt}` : ''}`;
    case 'substitute': return `Substitute${t}${m.newName ? ` → ${m.newName}` : ''}`;
    case 'add': return `Add ${[amt, m.newName || m.target].filter(Boolean).join(' ')}`.trim() || 'Add ingredient';
    case 'scale': return `Scale recipe ×${m.scale ?? '?'}`;
    default: return 'Change';
  }
}

export default function AiMacroLogger() {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [correction, setCorrection] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [library, setLibrary] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [recipeReview, setRecipeReview] = useState(null); // { recipe, rows, modifications, matchConfidence, fallbackEstimate }
  const [picker, setPicker] = useState(null);             // { candidates, modifications, fallbackEstimate }
  const [recipeServings, setRecipeServings] = useState(1);

  // Saved ingredient library + recipe list — used to recognize recipes and to
  // prefer real data over AI estimates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const list = await fetchLabelIngredients(); if (!cancelled) setLibrary(Array.isArray(list) ? list : []); }
      catch { /* best-effort enhancement — ignore */ }
      try { const rs = await fetchRecipes(); if (!cancelled) setRecipes(Array.isArray(rs) ? rs : []); }
      catch { /* best-effort — ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const libIndex = useMemo(() => {
    const map = new Map();
    for (const ing of library) if (ing && ing.name) map.set(normName(ing.name), ing);
    return map;
  }, [library]);
  const labelById = useMemo(() => {
    const map = new Map();
    for (const ing of library) if (ing && ing.id != null) map.set(Number(ing.id), ing);
    return map;
  }, [library]);
  // Keep the latest data reachable from async runEstimate without stale closures.
  const libIndexRef = useRef(libIndex); libIndexRef.current = libIndex;
  const labelByIdRef = useRef(labelById); labelByIdRef.current = labelById;
  const recipesRef = useRef(recipes); recipesRef.current = recipes;

  // Totals are always the live sum of the (editable) ingredient macros.
  const totals = useMemo(() => {
    const ings = estimate?.ingredients || [];
    return ings.reduce(
      (acc, x) => ({
        calories: acc.calories + n(x.calories),
        protein: acc.protein + n(x.protein),
        carbs: acc.carbs + n(x.carbs),
        fat: acc.fat + n(x.fat),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [estimate]);

  async function runEstimate(corr) {
    const desc = description.trim();
    if (!desc) {
      setError('Describe a meal first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const raw = await estimateMacros({
        description: desc,
        correction: corr || undefined,
        recipeNames: recipesRef.current.map(r => r.name),
      });
      const normalized = normalizeEstimate(raw);
      if (!normalized) throw new Error('The estimate came back in an unexpected format. Please try again.');
      // Prefer saved-library data for any ingredients we recognize by name.
      const freeform = enrichWithLibrary(normalized, libIndexRef.current);

      // Recipe command? Match the AI's suggested name against the real saved
      // recipes (we resolve — the AI never silently picks).
      const rl = raw?.recipeLog && typeof raw.recipeLog === 'object' ? raw.recipeLog : null;
      if (rl && rl.recipeName) {
        const match = matchRecipe(rl.recipeName, recipesRef.current);
        if (match.status === 'one') {
          setRecipeReview({
            recipe: match.recipe,
            rows: recipeReviewRows(match.recipe, labelByIdRef.current),
            modifications: rl.modifications || [],
            matchConfidence: rl.matchConfidence,
            fallbackEstimate: freeform,
          });
          setEstimate(null); setPicker(null); setRecipeServings(1);
          setReviseOpen(false); setCorrection('');
          return;
        }
        if (match.status === 'many') {
          setPicker({ candidates: match.candidates, modifications: rl.modifications || [], fallbackEstimate: freeform });
          setEstimate(null); setRecipeReview(null);
          setReviseOpen(false); setCorrection('');
          return;
        }
        // status 'none' → fall through to the freeform estimate.
      }
      setEstimate(freeform); setRecipeReview(null); setPicker(null);
      setReviseOpen(false); setCorrection('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Picker → pick one of the candidate recipes (ambiguous match).
  function choosePickerRecipe(recipe) {
    setRecipeReview({
      recipe,
      rows: recipeReviewRows(recipe, labelByIdRef.current),
      modifications: picker?.modifications || [],
      matchConfidence: 'medium',
      fallbackEstimate: picker?.fallbackEstimate || null,
    });
    setRecipeServings(1);
    setPicker(null);
  }

  // Log the matched saved recipe AS-IS through the normal recipe-log endpoint.
  async function logRecipeAsIs() {
    if (busy || !recipeReview?.recipe) return;
    setBusy('log');
    setError('');
    try {
      await createLogEntry({
        recipe_id: recipeReview.recipe.id,
        date: getLocalDateISO(),
        servings: Number(recipeServings) > 0 ? Number(recipeServings) : 1,
      });
      navigate('/', { state: { scrollToTop: true } });
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  // Escape hatch: log the AI freeform estimate instead of the matched recipe.
  function useFreeformInstead(fallback) {
    setEstimate(fallback || null);
    setRecipeReview(null);
    setPicker(null);
  }

  function updateMacro(idx, field, value) {
    setEstimate(prev => {
      if (!prev) return prev;
      const ingredients = prev.ingredients.map((ing, i) =>
        i === idx ? { ...ing, [field]: value === '' ? 0 : Number(value) } : ing
      );
      return { ...prev, ingredients };
    });
  }

  function clearAll() {
    setEstimate(null);
    setRecipeReview(null);
    setPicker(null);
    setRecipeServings(1);
    setDescription('');
    setCorrection('');
    setReviseOpen(false);
    setError('');
  }

  async function logOnce() {
    if (!estimate) return;
    setBusy('log');
    setError('');
    try {
      // Send the reviewed ingredient rows (with per-ingredient macros) so the
      // server persists the breakdown AND estimates micros (name/amount/unit).
      // Library-matched rows carry source:'library' + label_ingredient_id.
      const ingredients = (estimate.ingredients || [])
        .map(i => ({
          name: i.name,
          amount: i.quantity,
          unit: i.unit,
          calories: i.calories,
          protein_g: i.protein,
          carbs_g: i.carbs,
          fat_g: i.fat,
          source: i.source === 'library' ? 'library' : 'ai',
          ...(i.label_ingredient_id ? { label_ingredient_id: i.label_ingredient_id } : {}),
        }))
        .filter(i => i.name);
      await createCustomLog({
        date: getLocalDateISO(),
        name: estimate.mealName.trim() || 'Meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ...(ingredients.length ? { ingredients } : {}),
      });
      navigate('/', { state: { scrollToTop: true } });
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  async function saveAsRecipe() {
    if (!estimate) return;
    setBusy('save');
    setError('');
    try {
      const ingredients = estimate.ingredients
        .map(i => {
          const amount = `${i.quantity ? i.quantity : ''} ${i.unit || ''}`.trim() || 'as estimated';
          return { kind: 'line', name: i.name, amount };
        })
        .filter(i => i.name);
      await createRecipe({
        name: estimate.mealName.trim() || 'Meal',
        serving_size: '1 meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ingredients,
      });
      navigate(`/recipes?saved=${encodeURIComponent('Recipe saved from AI estimate.')}`);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  const conf = estimate ? (CONFIDENCE_META[estimate.confidence] || CONFIDENCE_META.medium) : null;

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>AI Macro Logger</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Describe a meal, review the estimate, then log it once.
      </p>

      {/* Input */}
      <div className="card" style={{ marginBottom: 18 }}>
        <label htmlFor="ai-meal-desc">Describe your meal</label>
        <textarea
          id="ai-meal-desc"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={5}
          style={{ width: '100%', resize: 'vertical', minHeight: 110, fontSize: '1rem', lineHeight: 1.5 }}
        />
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => runEstimate('')}
            disabled={loading || !description.trim()}
            style={{ minHeight: 48, fontWeight: 700 }}
          >
            {loading ? 'Estimating…' : estimate ? 'Re-generate from scratch' : 'Generate estimate'}
          </button>
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {/* Loading state */}
      {loading && !estimate && !recipeReview && !picker && (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Reading your request… this usually takes a few seconds.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !estimate && !recipeReview && !picker && !error && (
        <p className="empty-state" style={{ padding: 16 }}>
          Your estimate will appear here. Describe a meal — or say “log my &lt;recipe&gt;” — and tap <strong>Generate estimate</strong>.
        </p>
      )}

      {/* Recipe picker (ambiguous match) */}
      {picker && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Which recipe did you mean?</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            More than one saved recipe could match. Pick one to review before logging.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {picker.candidates.map(r => (
              <button key={r.id} type="button" className="btn-secondary" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choosePickerRecipe(r)}>
                {r.name}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={() => useFreeformInstead(picker.fallbackEstimate)}>
              None of these — use a freeform estimate
            </button>
            <button type="button" className="btn-secondary" onClick={clearAll}>Cancel</button>
          </div>
        </div>
      )}

      {/* Recipe-log review (matched saved recipe) */}
      {recipeReview && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Log saved recipe</h3>

          <div style={{ padding: 12, background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#312e81' }}>{recipeReview.recipe.name}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#6b21a8' }}>
              Matched from your saved recipes{recipeReview.matchConfidence ? ` · ${recipeReview.matchConfidence} confidence` : ''}.
            </div>
            <button
              type="button"
              onClick={() => useFreeformInstead(recipeReview.fallbackEstimate)}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#7c3aed', textDecoration: 'underline' }}
            >
              Not this recipe? Use a freeform estimate instead
            </button>
          </div>

          {recipeReview.modifications.length > 0 && (
            <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, marginBottom: 14, fontSize: 13, color: '#92400e' }}>
              <strong>Requested changes detected:</strong>
              <ul style={{ margin: '6px 0 6px', paddingLeft: 18 }}>
                {recipeReview.modifications.map((mdf, i) => (
                  <li key={i}>{describeModification(mdf)}</li>
                ))}
              </ul>
              <span>Applying changes is coming in the next update — for now this logs the recipe <strong>as saved</strong>.</span>
            </div>
          )}

          <div style={{ marginBottom: 12, maxWidth: 160 }}>
            <label htmlFor="ai-recipe-servings">Servings</label>
            <input
              id="ai-recipe-servings"
              type="number" min="0.1" step="0.1"
              value={recipeServings}
              onChange={e => setRecipeServings(e.target.value)}
            />
          </div>

          {/* Ingredient rows (read-only — from the saved recipe) */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Recipe ingredients</p>
            {recipeReview.rows.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>This recipe has no itemized ingredients.</p>
            ) : (
              recipeReview.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                  <span style={{ color: '#1f2937', fontWeight: 500 }}>
                    {r.name}
                    <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 8 }}>
                      {r.amountText != null ? r.amountText : (r.amount != null ? `${+Number(r.amount).toFixed(2)}${r.unit ? ` ${r.unit}` : ''}` : '')}
                    </span>
                  </span>
                  {r.calories != null && (
                    <span style={{ color: '#374151', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {Math.round(r.calories * (Number(recipeServings) > 0 ? Number(recipeServings) : 1))} cal
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Recipe totals (authoritative per-serving macros × servings) */}
          <div style={{ padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <strong style={{ color: '#1e3a8a' }}>Totals</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#0f172a' }}>
              {(() => {
                const s = Number(recipeServings) > 0 ? Number(recipeServings) : 1;
                const r = recipeReview.recipe;
                return `${Math.round((Number(r.calories) || 0) * s)} cal · P ${((Number(r.protein_g) || 0) * s).toFixed(1)}g · C ${((Number(r.carbs_g) || 0) * s).toFixed(1)}g · F ${((Number(r.fat_g) || 0) * s).toFixed(1)}g`;
              })()}
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={logRecipeAsIs} disabled={busy !== ''} style={{ minHeight: 48, fontWeight: 700 }}>
              {busy === 'log' ? 'Logging…' : 'Log recipe'}
            </button>
            <button type="button" className="btn-secondary" onClick={clearAll} disabled={busy !== ''}>Cancel</button>
          </div>
        </div>
      )}

      {/* Review */}
      {estimate && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Review estimate</h3>

          <div style={{ marginBottom: 12 }}>
            <label>Meal name</label>
            <input
              value={estimate.mealName}
              onChange={e => setEstimate(prev => ({ ...prev, mealName: e.target.value }))}
            />
          </div>

          {conf && (
            <div
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                background: conf.bg,
                border: `1px solid ${conf.border}`,
                color: conf.color,
                marginBottom: 12,
              }}
            >
              {conf.label}
            </div>
          )}

          {estimate.summary && (
            <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--color-text-body)' }}>{estimate.summary}</p>
          )}

          {/* Ingredient rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {estimate.ingredients.length === 0 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No ingredients were identified.</p>
            )}
            {estimate.ingredients.map((ing, idx) => (
              <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                  {ing.name}
                  <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 13 }}>
                    {ing.quantity ? `${ing.quantity} ${ing.unit}`.trim() : ing.unit}
                    {STATE_LABELS[ing.state] ? ` · ${STATE_LABELS[ing.state]}` : ''}
                  </span>
                  <span
                    title={ing.source === 'library' ? `From your saved ingredient: ${ing.matchedName || ing.name}` : 'AI estimate — not matched to a saved ingredient'}
                    style={{
                      marginLeft: 8, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                      ...(ing.source === 'library'
                        ? { background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46' }
                        : { background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#6b7280' }),
                    }}
                  >
                    {ing.source === 'library' ? 'Saved data' : 'AI estimate'}
                  </span>
                </div>
                {ing.notes && (
                  <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--color-text-faint)' }}>{ing.notes}</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 8, marginTop: 8 }}>
                  {[
                    ['calories', 'Cal'],
                    ['protein', 'P (g)'],
                    ['carbs', 'C (g)'],
                    ['fat', 'F (g)'],
                  ].map(([field, label]) => (
                    <div key={field}>
                      <label style={{ fontSize: 11 }}>{label}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={ing[field]}
                        onChange={e => updateMacro(idx, field, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ marginTop: 16, padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <strong style={{ color: '#1e3a8a' }}>Totals</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#0f172a' }}>
              {Math.round(totals.calories)} cal · P {totals.protein.toFixed(1)}g · C {totals.carbs.toFixed(1)}g · F {totals.fat.toFixed(1)}g
            </div>
          </div>

          {/* Assumptions / warnings */}
          {estimate.assumptions.length > 0 && (
            <div style={{ marginTop: 14, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
              <strong>Assumptions</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {estimate.warnings.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              <strong>Please double-check</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {estimate.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Revise */}
          <div style={{ marginTop: 16 }}>
            {!reviseOpen ? (
              <button type="button" className="btn-secondary" onClick={() => setReviseOpen(true)}>
                Revise estimate…
              </button>
            ) : (
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#f9fafb' }}>
                <label htmlFor="ai-correction">What should change?</label>
                <input
                  id="ai-correction"
                  value={correction}
                  onChange={e => setCorrection(e.target.value)}
                  placeholder="e.g. the rice was dry weight, not cooked"
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => runEstimate(correction)}
                    disabled={loading || !correction.trim()}
                  >
                    {loading ? 'Revising…' : 'Apply correction'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setReviseOpen(false); setCorrection(''); }}>
                    Cancel
                  </button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Re-sends your description plus this correction. You can also edit the macro values above by hand.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <div>
              <button
                type="button"
                className="btn-primary"
                onClick={logOnce}
                disabled={busy !== ''}
                style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                {busy === 'log' ? 'Logging…' : 'Log once'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Track this meal today without saving it to your recipe library.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn-secondary"
                onClick={saveAsRecipe}
                disabled={busy !== ''}
                style={{ width: '100%', minHeight: 48, fontWeight: 700 }}
              >
                {busy === 'save' ? 'Saving…' : 'Save as recipe'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Add this to your recipe library so you can reuse it later.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={clearAll} disabled={busy !== ''} style={{ alignSelf: 'flex-start' }}>
              Clear
            </button>
          </div>

          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
