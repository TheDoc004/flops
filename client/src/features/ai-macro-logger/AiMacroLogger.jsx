import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { estimateMacros } from '@shared/api/ai';
import { createCustomLog, createLogEntry } from '@shared/api/log';
import { createRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients, createLabelIngredient } from '@shared/api/labelIngredients';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { SERVING_UNITS, servingToStored } from '@shared/utils/servingBasis';
import { adjustPerServingMacrosForResolvedClient } from '@features/meal-logging/recipeLogMacros';
import { matchRecipe, applyModifications, resolvedReviewRows, recipeIngredientNames } from './recipeCommand';
import {
  enrichEstimate, strongMatchCount, basisFromLibrary, deriveBasis,
  scaleBasisToAmount, likelyLibraryMatches, searchLibrary,
} from './ingredientSource';

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

// Tidy number for display: drop trailing zeros (172, 3.2, 40.25).
const fmt = v => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 100) / 100);
};

/** Recompute a row's final macros from its basis + logged amount/unit. */
function applyFinal(ing) {
  const m = scaleBasisToAmount(ing.basis, ing.quantity, ing.unit);
  if (!m) return { ...ing, incompatible: true };
  return { ...ing, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, incompatible: false };
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
    // Whether the user gave explicit macros for this item in the message (tier 1).
    macroSource: i?.macroSource === 'provided' ? 'provided' : 'estimated',
    source: i?.macroSource === 'provided' ? 'provided' : 'ai',
    // Preserve the original AI/provided macros so we can revert after a library swap.
    aiMacros: { calories: n(i?.calories), protein: n(i?.protein), carbs: n(i?.carbs), fat: n(i?.fat) },
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

const AI_BADGE = {
  display: 'inline-block', fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
  background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#6b7280', whiteSpace: 'nowrap',
};

// Where an ingredient's macros came from (review badges).
const SOURCE_META = {
  provided: { label: 'Provided in message', bg: '#eef2ff', border: '#c7d2fe', color: '#3730a3', kind: null },
  library: { label: 'Ingredient library', bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', kind: 'saved ingredient' },
  common: { label: 'Common data', bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', kind: 'common food' },
  ai: { label: 'Estimated', bg: '#f3f4f6', border: '#e5e7eb', color: '#6b7280', kind: null },
  manual: { label: 'Manual', bg: '#fef3c7', border: '#fcd34d', color: '#92400e', kind: null },
};
const rowSourceKey = ing => (ing.overridden ? 'manual' : (SOURCE_META[ing.source] ? ing.source : 'ai'));

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
  const libraryRef = useRef(library); libraryRef.current = library;

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
        recipes: recipesRef.current.map(r => ({ name: r.name, ingredients: recipeIngredientNames(r, labelByIdRef.current) })),
      });
      const normalized = normalizeEstimate(raw);
      if (!normalized) throw new Error('The estimate came back in an unexpected format. Please try again.');
      // Prefer saved-library data for any ingredients we recognize by name.
      const freeform = enrichEstimate(normalized, libraryRef.current);

      // Recipe command? Match the AI's suggested name against the real saved
      // recipes (we resolve — the AI never silently picks).
      const rl = raw?.recipeLog && typeof raw.recipeLog === 'object' ? raw.recipeLog : null;
      if (rl && rl.recipeName) {
        const match = matchRecipe(rl.recipeName, recipesRef.current);
        if (match.status === 'one') {
          buildRecipeReview(match.recipe, rl.modifications || [], freeform, rl.matchConfidence);
          setEstimate(null);
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

  // Resolve a matched recipe + its modifications into a review (applied changes,
  // final preview rows, adjusted per-serving totals, and slot customizations).
  function buildRecipeReview(recipe, modifications, fallbackEstimate, matchConfidence) {
    const r = applyModifications(recipe, modifications, labelByIdRef.current, libIndexRef.current);
    const baseRows = resolvedReviewRows(recipe, labelByIdRef.current, r.resolvedBySlot);
    const sumRows = rows => rows.reduce(
      (a, x) => ({
        calories: a.calories + (Number(x.calories) || 0),
        protein_g: a.protein_g + (Number(x.protein_g) || 0),
        carbs_g: a.carbs_g + (Number(x.carbs_g) || 0),
        fat_g: a.fat_g + (Number(x.fat_g) || 0),
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );

    if (r.requiresCustomPath) {
      // Added / non-library-substituted items → log a custom instance from the
      // final rows. Bake the scale into the recipe portion; AI rows stay as-is.
      const s = r.servingsScale != null ? r.servingsScale : 1;
      const scaled = baseRows.map(row => ({
        ...row,
        amount: row.amount != null ? Math.round(row.amount * s * 100) / 100 : row.amount,
        calories: row.calories != null ? row.calories * s : row.calories,
        protein_g: row.protein_g != null ? row.protein_g * s : row.protein_g,
        carbs_g: row.carbs_g != null ? row.carbs_g * s : row.carbs_g,
        fat_g: row.fat_g != null ? row.fat_g * s : row.fat_g,
      }));
      const finalRows = [...scaled, ...r.addedRows];
      setRecipeReview({
        recipe, requiresCustomPath: true, rows: finalRows, total: sumRows(finalRows), perServing: null,
        customizations: null, applied: r.applied, unapplied: r.unapplied,
        hasAi: r.addedRows.length > 0, matchConfidence, fallbackEstimate,
      });
      setRecipeServings(1);
    } else {
      // Library-only mods → Phase 2 recipe-log path. adjust* needs a plain
      // {id: ingredient} object (not a Map); sum-of-rows fallback.
      const adjusted = adjustPerServingMacrosForResolvedClient(recipe, Object.fromEntries(labelByIdRef.current), r.resolvedBySlot);
      setRecipeReview({
        recipe, requiresCustomPath: false, rows: baseRows, perServing: adjusted || sumRows(baseRows), total: null,
        customizations: r.customizations, applied: r.applied, unapplied: r.unapplied,
        hasAi: false, matchConfidence, fallbackEstimate,
      });
      setRecipeServings(r.servingsScale != null ? r.servingsScale : 1);
    }
    setPicker(null);
  }

  // Picker → pick one of the candidate recipes (ambiguous match).
  function choosePickerRecipe(recipe) {
    buildRecipeReview(recipe, picker?.modifications || [], picker?.fallbackEstimate || null, 'medium');
  }

  // Log the matched saved recipe — with any applied modifications as
  // log_slot_customizations — through the normal recipe-log endpoint. The
  // server resolves the final rows + macros + micros; the original recipe is
  // never modified.
  async function logRecipe() {
    if (busy || !recipeReview?.recipe) return;
    setBusy('log');
    setError('');
    try {
      if (recipeReview.requiresCustomPath) {
        // Log a custom instance from the final resolved rows (adds / non-library
        // substitutes). Stores ingredients_json + estimates micros from the rows;
        // the original saved recipe is untouched.
        const ingredients = recipeReview.rows
          .filter(r => r.name)
          .map(r => ({
            name: r.name,
            amount: r.amount != null ? r.amount : undefined,
            unit: r.unit || '',
            calories: Number(r.calories) || 0,
            protein_g: Number(r.protein_g) || 0,
            carbs_g: Number(r.carbs_g) || 0,
            fat_g: Number(r.fat_g) || 0,
            source: r.source === 'ai' ? 'ai' : (r.source === 'recipe' ? 'recipe' : 'library'),
            ...(r.label_ingredient_id ? { label_ingredient_id: r.label_ingredient_id } : {}),
          }));
        const t = recipeReview.total;
        await createCustomLog({
          date: getLocalDateISO(),
          name: `${recipeReview.recipe.name} (modified)`,
          calories: t.calories, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g,
          ingredients,
        });
      } else {
        const custom = recipeReview.customizations || {};
        await createLogEntry({
          recipe_id: recipeReview.recipe.id,
          date: getLocalDateISO(),
          servings: Number(recipeServings) > 0 ? Number(recipeServings) : 1,
          ...(Object.keys(custom).length ? { log_slot_customizations: custom } : {}),
        });
      }
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

  // One updater for every per-row change: maps the row at idx through `fn`.
  function updateRow(idx, fn) {
    setEstimate(prev => {
      if (!prev) return prev;
      const ingredients = prev.ingredients.map((ing, i) => (i === idx ? fn(ing) : ing));
      return { ...prev, ingredients };
    });
  }

  // Switch (or clear) the saved ingredient a row is matched to. Rebuilds the
  // row's basis from the selected ingredient and recomputes final macros.
  function setRowIngredient(idx, labelId) {
    updateRow(idx, ing => {
      if (!labelId) {
        // Back to the original macros — restore "provided" if the user pasted them.
        const baseSource = ing.macroSource === 'provided' ? 'provided' : 'ai';
        const reverted = { ...ing, ...ing.aiMacros, source: baseSource, label_ingredient_id: undefined, matchedName: undefined, overridden: false, userPicked: true };
        return applyFinal({ ...reverted, basis: deriveBasis(reverted, libraryRef.current) });
      }
      const lib = (libraryRef.current || []).find(x => Number(x.id) === Number(labelId));
      if (!lib) return ing;
      const basis = basisFromLibrary(lib);
      return applyFinal({ ...ing, source: 'library', label_ingredient_id: Number(lib.id), matchedName: lib.name, overridden: false, userPicked: true, basis });
    });
  }

  // Edit the parsed display name (does not touch macros).
  function updateName(idx, value) {
    updateRow(idx, ing => ({ ...ing, name: value }));
  }

  // Edit the logged amount / unit — recompute final from the unchanged basis.
  function updateAmount(idx, value) {
    updateRow(idx, ing => applyFinal({ ...ing, quantity: value === '' ? 0 : Number(value) }));
  }
  function updateUnit(idx, value) {
    updateRow(idx, ing => applyFinal({ ...ing, unit: value }));
  }

  // A library match is only ever a suggestion. The moment the user edits the
  // macros or picks "Manual entry", the row is detached from the saved
  // ingredient (its id/name are dropped) so no stale library link survives.
  function toManual(ing) {
    return { ...ing, source: 'manual', overridden: true, label_ingredient_id: undefined, matchedName: undefined, incompatible: false, userPicked: true };
  }

  // Edit the nutrition basis (amount or per-basis macro). Editing the basis is a
  // manual override — detach from any library match and recompute final.
  function updateBasisAmount(idx, value) {
    updateRow(idx, ing => applyFinal(toManual({ ...ing, basis: { ...ing.basis, amount: value === '' ? 0 : Number(value) } })));
  }
  function updateBasisMacro(idx, field, value) {
    updateRow(idx, ing => applyFinal(toManual({ ...ing, basis: { ...ing.basis, [field]: value === '' ? 0 : Number(value) } })));
  }

  // Always-available source switch: estimate baseline, manual entry, a specific
  // saved ingredient, or "search the full library". Every option is reversible.
  function setRowSource(idx, value) {
    if (value === '__search__') { updateRow(idx, ing => ({ ...ing, expanded: true })); return; }
    if (value === 'manual') {
      // Keep the current numbers as the starting point the user will edit; drop
      // the library link so the source is genuinely "manual".
      updateRow(idx, ing => applyFinal(toManual({ ...ing })));
      return;
    }
    if (value === 'estimate') { setRowIngredient(idx, ''); return; } // back to AI/provided baseline
    setRowIngredient(idx, value); // a saved-ingredient id
  }

  // Per-row UI state (expand panel, library search) lives on the row itself.
  function toggleRowPanel(idx) {
    updateRow(idx, ing => ({ ...ing, expanded: !ing.expanded }));
  }
  function setRowSearch(idx, value) {
    updateRow(idx, ing => ({ ...ing, matchSearch: value }));
  }
  function toggleSaveToLibrary(idx) {
    updateRow(idx, ing => ({ ...ing, saveToLibrary: !ing.saveToLibrary }));
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

  // Create label-ingredient records for the rows the user checked "Save to
  // library" on (and that aren't already a saved match). Best-effort: a failure
  // on one row never blocks logging. Returns { [idx]: newLabelIngredientId }.
  async function saveCheckedIngredientsToLibrary(rows) {
    const out = {};
    for (let idx = 0; idx < rows.length; idx++) {
      const i = rows[idx];
      if (!i || !i.saveToLibrary || i.label_ingredient_id || !i.basis || !String(i.name || '').trim()) continue;
      try {
        const b = i.basis;
        const known = SERVING_UNITS.includes(b.unit);
        const stored = servingToStored({
          serving_amount: b.amount,
          serving_unit: known ? b.unit : 'custom',
          serving_unit_custom: known ? '' : b.unit,
          gram_equivalent: '',
        });
        const created = await createLabelIngredient({
          name: i.name.trim(),
          serving_size_text: stored.serving_size_text,
          calories: b.calories, protein_g: b.protein, carbs_g: b.carbs, fat_g: b.fat,
          tracking_type: stored.tracking_type,
          ...(stored.grams_per_serving != null ? { grams_per_serving: stored.grams_per_serving } : {}),
          ...(stored.serving_quantity != null ? { serving_quantity: stored.serving_quantity } : {}),
          ...(stored.unit_name != null ? { unit_name: stored.unit_name } : {}),
          ...(stored.grams_per_unit != null ? { grams_per_unit: stored.grams_per_unit } : {}),
        });
        if (created && created.id != null) out[idx] = Number(created.id);
      } catch { /* best-effort — skip this row, still log the meal */ }
    }
    return out;
  }

  async function logOnce() {
    if (!estimate) return;
    setBusy('log');
    setError('');
    try {
      // Optional: persist verified/edited estimates to the ingredient library
      // (only the rows the user explicitly checked, and only ones not already
      // backed by a saved ingredient — so we never create duplicates).
      const saved = await saveCheckedIngredientsToLibrary(estimate.ingredients || []);

      // Send the reviewed ingredient rows (with per-ingredient macros) so the
      // server persists the breakdown AND estimates micros (name/amount/unit).
      // Library-matched rows carry source:'library' + label_ingredient_id.
      const ingredients = (estimate.ingredients || [])
        .map((i, idx) => {
          // Resolve the FINAL source once, and only attach a library id when the
          // source is genuinely 'library' — never a stale id from a match the
          // user has since edited or switched away from.
          const newId = saved[idx];
          let source, labelId;
          if (newId) {
            source = 'library'; labelId = newId;          // just saved to the library
          } else if (i.overridden || i.source === 'manual') {
            source = 'manual'; labelId = undefined;         // user edited the macros
          } else if (i.source === 'library' && i.label_ingredient_id) {
            source = 'library'; labelId = i.label_ingredient_id;
          } else if (['provided', 'common', 'ai'].includes(i.source)) {
            source = i.source; labelId = undefined;
          } else {
            source = 'ai'; labelId = undefined;
          }
          return {
            name: i.name,
            amount: i.quantity,
            unit: i.unit,
            calories: i.calories,
            protein_g: i.protein,
            carbs_g: i.carbs,
            fat_g: i.fat,
            source,
            ...(labelId ? { label_ingredient_id: labelId } : {}),
          };
        })
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

          {recipeReview.applied.length > 0 && (
            <div style={{ padding: 12, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 10, marginBottom: 12, fontSize: 13, color: '#065f46' }}>
              <strong>Applied changes:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {recipeReview.applied.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {recipeReview.unapplied.length > 0 && (
            <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, marginBottom: 12, fontSize: 13, color: '#92400e' }}>
              <strong>Couldn’t apply (logging without these):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {recipeReview.unapplied.map((u, i) => <li key={i}>{u.text} — <span style={{ color: '#a16207' }}>{u.reason}</span></li>)}
              </ul>
            </div>
          )}

          {!recipeReview.requiresCustomPath && (
            <div style={{ marginBottom: 12, maxWidth: 160 }}>
              <label htmlFor="ai-recipe-servings">Servings</label>
              <input
                id="ai-recipe-servings"
                type="number" min="0.1" step="0.1"
                value={recipeServings}
                onChange={e => setRecipeServings(e.target.value)}
              />
            </div>
          )}

          {recipeReview.hasAi && (
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#6b7280' }}>
              Items badged <span style={{ ...AI_BADGE }}>AI est.</span> are AI estimates (not from your library) — review before logging.
            </p>
          )}

          {/* Final ingredient rows (after applied changes) */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Final ingredients</p>
            {recipeReview.rows.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>This recipe has no itemized ingredients.</p>
            ) : (
              recipeReview.rows.map((r, i) => {
                const s = recipeReview.requiresCustomPath ? 1 : (Number(recipeServings) > 0 ? Number(recipeServings) : 1);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13, alignItems: 'baseline' }}>
                    <span style={{ color: '#1f2937', fontWeight: 500, minWidth: 0 }}>
                      {r.name}
                      <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 8 }}>
                        {r.amountText != null ? r.amountText : (r.amount != null ? `${+Number(r.amount).toFixed(2)}${r.unit ? ` ${r.unit}` : ''}` : '')}
                      </span>
                      {r.source === 'ai' && <span style={{ ...AI_BADGE, marginLeft: 8 }}>AI est.</span>}
                    </span>
                    {r.calories != null && (
                      <span style={{ color: '#374151', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {Math.round(r.calories * s)} cal
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Totals — final macros for the logged instance */}
          <div style={{ padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <strong style={{ color: '#1e3a8a' }}>Totals</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#0f172a' }}>
              {(() => {
                const t = recipeReview.requiresCustomPath
                  ? recipeReview.total
                  : (() => { const s = Number(recipeServings) > 0 ? Number(recipeServings) : 1; const ps = recipeReview.perServing; return { calories: (Number(ps.calories) || 0) * s, protein_g: (Number(ps.protein_g) || 0) * s, carbs_g: (Number(ps.carbs_g) || 0) * s, fat_g: (Number(ps.fat_g) || 0) * s }; })();
                return `${Math.round(t.calories)} cal · P ${t.protein_g.toFixed(1)}g · C ${t.carbs_g.toFixed(1)}g · F ${t.fat_g.toFixed(1)}g`;
              })()}
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={logRecipe} disabled={busy !== ''} style={{ minHeight: 48, fontWeight: 700 }}>
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
            {estimate.ingredients.map((ing, idx) => {
              const meta = SOURCE_META[rowSourceKey(ing)];
              const savedName = ing.label_ingredient_id != null
                ? (labelById.get(Number(ing.label_ingredient_id))?.name || ing.matchedName)
                : null;
              const sourceText = ing.overridden
                ? 'Manually adjusted'
                : ing.source === 'provided'
                  ? 'Provided in message — using your macros'
                  : ing.source === 'library'
                    ? `Using saved ingredient: ${savedName || ing.matchedName || 'saved item'}`
                    : ing.source === 'common'
                      ? `Using common food${ing.matchedName ? `: ${ing.matchedName}` : `: ${ing.name}`}`
                      : `Using AI estimate: ${ing.name}`;
              const basis = ing.basis || deriveBasis(ing, library);
              const basisLabel = basis.perKind === '100g'
                ? 'per 100 g'
                : basis.perKind === 'serving'
                  ? `per serving (${fmt(basis.amount)} ${basis.unit})`
                  : `per ${basis.amount === 1 ? '' : `${fmt(basis.amount)} `}${basis.unit}`;
              // Dropdown options: likely matches (limited) or full-library search.
              const q = String(ing.matchSearch || '').trim();
              let options = q ? searchLibrary(q, library) : likelyLibraryMatches(ing.name, library);
              if (ing.label_ingredient_id != null && !options.some(o => Number(o.id) === Number(ing.label_ingredient_id))) {
                const cur = labelById.get(Number(ing.label_ingredient_id));
                if (cur) options = [cur, ...options];
              }
              const ambiguous = !ing.userPicked && !ing.overridden && ing.source === 'library' && strongMatchCount(ing.name, library) >= 2;
              // Always-visible source switch: baseline estimate / manual / a few
              // likely saved matches (+ the current one) / open full-library search.
              let srcLibOpts = likelyLibraryMatches(ing.name, library).slice(0, 6);
              if (ing.label_ingredient_id != null && !srcLibOpts.some(o => Number(o.id) === Number(ing.label_ingredient_id))) {
                const cur = labelById.get(Number(ing.label_ingredient_id));
                if (cur) srcLibOpts = [cur, ...srcLibOpts];
              }
              const estimateLabel = ing.macroSource === 'provided' ? 'Provided in message' : 'AI estimate';
              const srcValue = ing.source === 'library' && ing.label_ingredient_id != null
                ? String(ing.label_ingredient_id)
                : (ing.overridden || ing.source === 'manual') ? 'manual' : 'estimate';
              return (
                <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
                  {/* --- Collapsed summary (always visible) --- */}
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                    {ing.name}
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 13 }}>
                      {ing.quantity ? `${fmt(ing.quantity)} ${ing.unit}`.trim() : ing.unit}
                      {STATE_LABELS[ing.state] ? ` · ${STATE_LABELS[ing.state]}` : ''}
                    </span>
                    <span
                      title={ing.overridden ? 'You edited these macros' : (meta.kind ? `From your ${meta.kind}${ing.matchedName ? `: ${ing.matchedName}` : ''}` : 'AI estimate — no saved or common match')}
                      style={{
                        marginLeft: 8, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                        background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color,
                      }}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 12, color: 'var(--color-text-muted)' }}>{sourceText}</div>
                  <div style={{ marginTop: 4, fontSize: 13.5, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{fmt(ing.calories)} cal</strong> · P {fmt(ing.protein)}g · C {fmt(ing.carbs)}g · F {fmt(ing.fat)}g
                  </div>

                  {/* Always-visible macro-source switch — a match is only a suggestion */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label htmlFor={`ai-source-${idx}`} style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Source:</label>
                    <select
                      id={`ai-source-${idx}`}
                      value={srcValue}
                      onChange={e => setRowSource(idx, e.target.value)}
                      style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13 }}
                    >
                      <option value="estimate">{estimateLabel}</option>
                      <option value="manual">Manual entry</option>
                      {srcLibOpts.length > 0 && (
                        <optgroup label="Ingredient library">
                          {srcLibOpts.map(li => (
                            <option key={li.id} value={String(li.id)}>{li.name}</option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__search__">Search full library…</option>
                    </select>
                  </div>

                  {ambiguous && (
                    <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#92400e' }}>
                      Multiple saved matches found — confirm which one you used.
                    </p>
                  )}
                  {ing.notes && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-faint)' }}>{ing.notes}</p>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleRowPanel(idx)}
                    aria-expanded={!!ing.expanded}
                    style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#2563eb', fontWeight: 600 }}
                  >
                    {ing.expanded ? 'Hide nutrition basis ▾' : 'Review nutrition basis ▸'}
                  </button>

                  {/* --- Expanded basis editor --- */}
                  {ing.expanded && (
                    <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Name + amount + unit */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11 }}>Ingredient name</label>
                          <input value={ing.name} onChange={e => updateName(idx, e.target.value)} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11 }}>Amount used</label>
                            <input type="number" min="0" step="0.1" value={ing.quantity} onChange={e => updateAmount(idx, e.target.value)} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11 }}>Unit</label>
                            <input value={ing.unit} onChange={e => updateUnit(idx, e.target.value)} placeholder="g" />
                          </div>
                        </div>
                      </div>

                      {/* Matched saved ingredient — likely matches first, search for the rest */}
                      <div>
                        <label htmlFor={`ai-match-${idx}`} style={{ fontSize: 11 }}>Saved ingredient</label>
                        <input
                          value={ing.matchSearch || ''}
                          onChange={e => setRowSearch(idx, e.target.value)}
                          placeholder="Search your ingredient library…"
                          style={{ marginBottom: 6 }}
                        />
                        <select
                          id={`ai-match-${idx}`}
                          value={ing.label_ingredient_id ?? ''}
                          onChange={e => setRowIngredient(idx, e.target.value)}
                          style={{ width: '100%', fontSize: 13 }}
                        >
                          <option value="">— No saved ingredient (estimate) —</option>
                          {options.map(li => (
                            <option key={li.id} value={li.id}>{li.name}</option>
                          ))}
                        </select>
                        {!q && options.length === 0 && (
                          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                            No likely matches — search above to browse your full library.
                          </p>
                        )}
                        {ing.incompatible && (
                          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#92400e' }}>
                            Couldn’t auto-scale that saved item to “{ing.unit || 'this unit'}” — adjust the basis below.
                          </p>
                        )}
                      </div>

                      {/* Nutrition basis */}
                      <div style={{ background: '#f9fafb', border: '1px solid #eef0f3', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                          Nutrition basis <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>· {basisLabel}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(64px, 1fr))', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11 }}>Basis amt</label>
                            <input type="number" min="0" step="0.1" value={basis.amount} onChange={e => updateBasisAmount(idx, e.target.value)} />
                          </div>
                          {[
                            ['calories', 'Cal'],
                            ['protein', 'P (g)'],
                            ['carbs', 'C (g)'],
                            ['fat', 'F (g)'],
                          ].map(([field, label]) => (
                            <div key={field}>
                              <label style={{ fontSize: 11 }}>{label}</label>
                              <input type="number" min="0" step="0.1" value={basis[field]} onChange={e => updateBasisMacro(idx, field, e.target.value)} />
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12.5, color: '#0f172a' }}>
                          Calculated for {fmt(ing.quantity)} {ing.unit}: <strong>{fmt(ing.calories)} cal</strong> · P {fmt(ing.protein)}g · C {fmt(ing.carbs)}g · F {fmt(ing.fat)}g
                        </div>
                      </div>

                      {/* Save to library — only when not already backed by a saved ingredient */}
                      {ing.label_ingredient_id == null && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--color-text-body)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!ing.saveToLibrary} onChange={() => toggleSaveToLibrary(idx)} style={{ width: 16, height: 16 }} />
                          Save to ingredient library when I log this
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
