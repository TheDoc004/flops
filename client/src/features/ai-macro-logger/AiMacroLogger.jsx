import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { estimateMacros } from '@shared/api/ai';
import { createCustomLog, createLogEntry } from '@shared/api/log';
import { createRecipe, fetchRecipes, updateRecipe } from '@shared/api/recipes';
import { addIngredientToRecipe } from './recipePersist';
import { fetchLabelIngredients, createLabelIngredient } from '@shared/api/labelIngredients';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { buildLibraryBackedIngredients } from './recipeFromEstimate';
import { SERVING_UNITS, servingToStored } from '@shared/utils/servingBasis';
import Reveal from '@shared/ui/Reveal';
import { receiptToApiIngredients } from '@features/meal-logging/recipeReceipt';
import { matchRecipe, applyModifications, resolvedReviewRows, recipeIngredientNames, resolveModification, mergeRecipeModifications } from './recipeCommand';
import RecipeFixUpList from './RecipeFixUpList';
import ConversationThread from './ConversationThread';
import FollowUpComposer from './FollowUpComposer';
import VoiceInput from './VoiceInput';
import { reconcileMealPrep } from './mealPrep';
import {
  enrichEstimate, strongMatchCount, basisFromLibrary, deriveBasis,
  scaleBasisToAmount, likelyLibraryMatches, searchLibrary, libraryForPrompt,
} from './ingredientSource';

const PLACEHOLDER =
  'I had three eggs, toast, and yogurt — or “log my overnight oats”…';

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
    // The saved ingredient the AI says this is; resolveIngredientSource checks
    // it against the real library before trusting it.
    savedIngredient: typeof i?.savedIngredient === 'string' && i.savedIngredient.trim()
      ? i.savedIngredient.trim()
      : null,
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
  provided: { label: 'Provided in message', short: 'Yours', bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', kind: null },
  library: { label: 'Ingredient library', short: 'Saved', bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', kind: 'saved ingredient' },
  common: { label: 'Common data', short: 'Common', bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', kind: 'common food' },
  ai: { label: 'Estimated', short: 'AI', bg: '#f3f4f6', border: '#e5e7eb', color: '#6b7280', kind: null },
  manual: { label: 'Manual', short: 'Edited', bg: '#fef3c7', border: '#fcd34d', color: '#92400e', kind: null },
};
const rowSourceKey = ing => (ing.overridden ? 'manual' : (SOURCE_META[ing.source] ? ing.source : 'ai'));

/**
 * Speak or describe a meal in natural language. Renders as a full page by
 * default, or inline inside a dialog when `inModal` is set (e.g. the dashboard
 * popup). In modal mode a successful log calls `onLogged` (to refresh the host)
 * and `onClose` (to shut the dialog) instead of navigating away.
 */
export default function AiMacroLogger({ inModal = false, onClose, onLogged, initialDate } = {}) {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  // The conversation: alternating user/AI messages shown as chat bubbles.
  const [thread, setThread] = useState([]);
  // Corrections applied so far (oldest → newest) — sent with every revision so
  // the AI never undoes an earlier fix.
  const [corrections, setCorrections] = useState([]);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState('');
  const [library, setLibrary] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [recipeReview, setRecipeReview] = useState(null); // { recipe, rows, modifications, matchConfidence, fallbackEstimate }
  const [picker, setPicker] = useState(null);             // { candidates, modifications, fallbackEstimate }
  const [recipeServings, setRecipeServings] = useState(1);
  // Changes already written back into the saved recipe (by their label).
  const [kept, setKept] = useState([]);
  const [keepBusy, setKeepBusy] = useState('');
  // Meal-prep split for the current freeform estimate: layered detection
  // (deterministic parse of the description > model's mealPrep > manual
  // toggle in the review card). servings null = prep with unknown split.
  const [prep, setPrep] = useState({ isMealPrep: false, servings: null });
  // Which day "Log once" writes to — defaults to today, editable for backfill.
  const [logDate, setLogDate] = useState(initialDate || getLocalDateISO());
  const descRef = useRef(null);

  // Put the cursor in the description box on open so you can type right away
  // (voice input stays one tap away). Deferred a frame so it wins over the
  // dialog's own focus handling when the logger opens as the dashboard popup.
  useEffect(() => {
    const id = requestAnimationFrame(() => descRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

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
    // A revision refines whatever is on screen — a freeform estimate OR a
    // matched recipe; anything else is a fresh start.
    const isRevision = !!corr && (!!estimate || !!recipeReview);
    const allCorrections = isRevision ? [...corrections, corr] : [];
    setLoading(true);
    setError('');
    try {
      const raw = await estimateMacros({
        description: desc,
        corrections: allCorrections.length ? allCorrections : undefined,
        // Snapshot of what the user is looking at (incl. their manual edits) —
        // the AI treats it as the baseline and changes only what corr asks.
        // A recipe review has no freeform estimate to snapshot; there the
        // correction history alone drives the (cumulative) modification list.
        currentEstimate: isRevision && estimate
          ? {
              mealName: estimate.mealName,
              ingredients: estimate.ingredients.map(i => ({
                name: i.name, quantity: i.quantity, unit: i.unit, state: i.state,
                calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat,
                macroSource: i.macroSource, savedIngredient: i.savedIngredient,
              })),
            }
          : undefined,
        recipes: recipesRef.current.map(r => {
          const entry = { name: r.name, ingredients: recipeIngredientNames(r, labelByIdRef.current) };
          // Active meal preps (limited templates with servings left) get
          // leftover metadata so the AI can recognize "log my meal prep".
          if (r.recipe_kind === 'limited' && Number(r.remaining_uses) > 0) {
            const made = r.created_at ? new Date(r.created_at).getTime() : NaN;
            entry.prep = {
              remainingServings: Number(r.remaining_uses),
              totalServings: Number(r.max_uses) > 0 ? Number(r.max_uses) : null,
              madeDaysAgo: Number.isFinite(made)
                ? Math.max(0, Math.floor((Date.now() - made) / 86400000))
                : null,
            };
          }
          return entry;
        }),
        // The user's own ingredients, with the unit each is measured in, so the
        // model can name a match and keep the unit they actually said.
        savedIngredients: libraryForPrompt(libraryRef.current),
      });
      const normalized = normalizeEstimate(raw);
      if (!normalized) throw new Error('The estimate came back in an unexpected format. Please try again.');
      // Prefer saved-library data for any ingredients we recognize by name.
      const freeform = enrichEstimate(normalized, libraryRef.current);

      // Grow the conversation: the user's message + the AI's reply. A fresh
      // estimate starts a new thread from the description. Recipe reviews keep
      // the same thread, so a correction there refines instead of restarting.
      const aiText =
        (typeof raw?.reply === 'string' && raw.reply.trim()) ||
        freeform.summary ||
        "Here's my estimate — check the breakdown below.";
      const growThread = () => {
        setThread(t => [
          ...(isRevision ? t : [{ role: 'user', text: desc }]),
          ...(isRevision ? [{ role: 'user', text: corr }] : []),
          { role: 'ai', text: aiText },
        ]);
        setCorrections(allCorrections);
        setFollowUp('');
      };

      // Recipe command? Match the AI's suggested name against the real saved
      // recipes (we resolve — the AI never silently picks).
      const rl = raw?.recipeLog && typeof raw.recipeLog === 'object' ? raw.recipeLog : null;
      if (rl && rl.recipeName) {
        // Follow-ups on a matched recipe often return a partial modification
        // list — merge onto the already-applied swaps instead of replacing them.
        if (isRevision && recipeReview) {
          buildRecipeReview(
            recipeReview.recipe,
            mergeRecipeModifications(recipeReview.modifications, rl.modifications),
            freeform,
            recipeReview.matchConfidence || rl.matchConfidence
          );
          setEstimate(null);
          growThread();
          return;
        }
        const match = matchRecipe(rl.recipeName, recipesRef.current);
        if (match.status === 'one') {
          buildRecipeReview(match.recipe, rl.modifications || [], freeform, rl.matchConfidence);
          setEstimate(null);
          growThread();
          return;
        }
        if (match.status === 'many') {
          setPicker({ candidates: match.candidates, modifications: rl.modifications || [], fallbackEstimate: freeform });
          setEstimate(null); setRecipeReview(null);
          growThread();
          return;
        }
        // status 'none' → fall through to the freeform estimate.
      }
      setEstimate(freeform); setRecipeReview(null); setPicker(null);
      setPrep(reconcileMealPrep(desc, raw?.mealPrep));
      growThread();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Resolve a matched recipe + its modifications into a review (applied changes,
  // final preview rows, and a receipt to POST with recipe_id).
  function buildRecipeReview(recipe, modifications, fallbackEstimate, matchConfidence) {
    const r = applyModifications(recipe, modifications, labelByIdRef.current, libIndexRef.current);
    const baseRows = resolvedReviewRows(recipe, labelByIdRef.current, r.resolvedLines, r.droppedLines);
    const keepable = (r.keepable || []).filter(k => k.kind === 'ingredient');
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
      // Extra / non-library rows: bake the scale into the recipe portion so
      // added items stay at the amount the user asked for; log servings = 1.
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
        recipe, modifications, requiresCustomPath: true, rows: finalRows, total: sumRows(finalRows), perServing: null,
        applied: r.applied, unapplied: r.unapplied, keepable,
        hasAi: r.addedRows.some(x => x.source === 'ai'), matchConfidence, fallbackEstimate,
      });
      setRecipeServings(1);
    } else {
      setRecipeReview({
        recipe, modifications, requiresCustomPath: false, rows: baseRows, perServing: sumRows(baseRows), total: null,
        applied: r.applied, unapplied: r.unapplied, keepable,
        hasAi: false, matchConfidence, fallbackEstimate,
      });
      setRecipeServings(r.servingsScale != null ? r.servingsScale : 1);
    }
    setPicker(null);
  }

  async function keepChange(item) {
    if (!recipeReview?.recipe || keepBusy) return;
    setKeepBusy(item.label);
    setError('');
    try {
      const body = addIngredientToRecipe(recipeReview.recipe, item.row);
      if (!body) {
        setError('That change can’t be saved into this recipe automatically — open it in Meal Builder to add it.');
        return;
      }
      await updateRecipe(recipeReview.recipe.id, body);
      const rs = await fetchRecipes();
      setRecipes(Array.isArray(rs) ? rs : []);
      setKept(k => [...k, item.label]);
    } catch (e) {
      setError(e.message);
    } finally {
      setKeepBusy('');
    }
  }

  // A change the AI couldn't resolve, pointed at a saved ingredient by hand:
  // patch that modification and rebuild the review so it goes through the same
  // library path an AI-matched swap would.
  function resolveUnapplied(item, ingredient, amount, unit) {
    if (!recipeReview?.recipe || !ingredient) return;
    buildRecipeReview(
      recipeReview.recipe,
      resolveModification(recipeReview.modifications, item.modIndex, ingredient, amount, unit),
      recipeReview.fallbackEstimate,
      recipeReview.matchConfidence
    );
  }

  // Picker → pick one of the candidate recipes (ambiguous match).
  function choosePickerRecipe(recipe) {
    buildRecipeReview(recipe, picker?.modifications || [], picker?.fallbackEstimate || null, 'medium');
  }

  // After a successful log: in modal mode, refresh the host (dashboard) and
  // close the dialog in place; as a full page, navigate to wherever the entry
  // landed (today → dashboard, a past day → History).
  function afterLog(date) {
    if (inModal) { onLogged?.(); onClose?.(); return; }
    if (date === getLocalDateISO()) navigate('/', { state: { scrollToTop: true } });
    else navigate('/history');
  }

  // Log the matched saved recipe through POST /api/log with recipe_id + the
  // already-built receipt. Limited-use templates still decrement; History
  // still shows the recipe name. The saved recipe itself is never modified.
  async function logRecipe() {
    if (busy || !recipeReview?.recipe) return;
    setBusy('log');
    setError('');
    try {
      const ingredients = receiptToApiIngredients(recipeReview.rows);
      await createLogEntry({
        recipe_id: recipeReview.recipe.id,
        date: logDate || getLocalDateISO(),
        servings: recipeReview.requiresCustomPath
          ? 1
          : (Number(recipeServings) > 0 ? Number(recipeServings) : 1),
        ...(ingredients.length ? { ingredients } : {}),
      });
      // Today's logs live on the dashboard; backfilled days are found in History.
      afterLog(logDate || getLocalDateISO());
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

  // Always-available source switch: estimate baseline, manual entry, or a
  // specific saved ingredient (found via the search box). Every option is reversible.
  function setRowSource(idx, value) {
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
    setPrep({ isMealPrep: false, servings: null });
    setLogDate(initialDate || getLocalDateISO());
    setDescription('');
    setThread([]);
    setCorrections([]);
    setFollowUp('');
    setKept([]);
    setError('');
  }

  // Create one library ingredient from a reviewed row's nutrition basis. Returns
  // the new id, or null if the row can't be stored (no basis) or the save fails.
  // Best-effort: callers never let a failure here block logging/saving.
  async function createLibraryIngredientFromRow(i) {
    if (!i || !i.basis || !String(i.name || '').trim()) return null;
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
      return created && created.id != null ? Number(created.id) : null;
    } catch {
      return null; // best-effort — skip this row
    }
  }

  // Create label-ingredient records for the rows the user checked "Save to
  // library" on (and that aren't already a saved match). Best-effort: a failure
  // on one row never blocks logging. Returns { [idx]: newLabelIngredientId }.
  async function saveCheckedIngredientsToLibrary(rows) {
    const out = {};
    for (let idx = 0; idx < rows.length; idx++) {
      const i = rows[idx];
      if (!i || !i.saveToLibrary || i.label_ingredient_id || !i.basis || !String(i.name || '').trim()) continue;
      const id = await createLibraryIngredientFromRow(i);
      if (id != null) out[idx] = id;
    }
    return out;
  }

  // For each reviewed row, resolve a library ingredient id so the saved recipe's
  // amounts stay editable at log time. Rows already matched to a saved ingredient
  // reuse that id; every other row with a real quantity gets a NEW library entry
  // created from its basis. Rows with no quantity ("as estimated") get null and
  // stay as plain, non-editable recipe lines. Returns an array aligned to `rows`.
  async function resolveLibraryIdsForRows(rows) {
    const ids = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const i = rows[idx];
      if (!i || !String(i.name || '').trim()) { ids[idx] = null; continue; }
      if (i.label_ingredient_id) { ids[idx] = Number(i.label_ingredient_id); continue; }
      if (!(Number(i.quantity) > 0) || !i.basis) { ids[idx] = null; continue; }
      ids[idx] = await createLibraryIngredientFromRow(i);
    }
    return ids;
  }

  async function logOnce() {
    if (!estimate || !estimate.ingredients.length) return;
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
      const date = logDate || getLocalDateISO();
      await createCustomLog({
        date,
        name: estimate.mealName.trim() || 'Meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ...(ingredients.length ? { ingredients } : {}),
      });
      // Today's logs live on the dashboard; backfilled days are found in History.
      afterLog(date);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  // Save the batch as a LIMITED-USE template: per-serving macros, N uses.
  // Each logged serving decrements remaining_uses server-side; at 0 the
  // template auto-archives. Optionally logs the first serving right away.
  async function saveAsMealPrep() {
    if (!estimate || !prep.isMealPrep || prep.servings == null) return;
    const nServings = prep.servings;
    setBusy('prep');
    setError('');
    try {
      const perServing = v => Math.round((v / nServings) * 10) / 10;
      // Back each ingredient with a library entry so per-serving amounts stay
      // editable at log time; amounts are split across the N servings.
      const ids = await resolveLibraryIdsForRows(estimate.ingredients);
      const { ingredients } = buildLibraryBackedIngredients(estimate.ingredients, ids, nServings);
      await createRecipe({
        name: estimate.mealName.trim() || 'Meal prep',
        serving_size: `1 of ${nServings} meal-prep servings`,
        calories: perServing(totals.calories),
        protein_g: perServing(totals.protein),
        carbs_g: perServing(totals.carbs),
        fat_g: perServing(totals.fat),
        ingredients,
        recipe_kind: 'limited',
        remaining_uses: nServings,
        max_uses: nServings,
        meal_builder_meta: { source: 'ai_meal_prep' },
      });
      navigate(`/recipes?saved=${encodeURIComponent(`Meal prep saved — ${nServings} servings ready to log.`)}`);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  async function saveAsRecipe() {
    if (!estimate || !estimate.ingredients.length) return;
    setBusy('save');
    setError('');
    try {
      // Amounts live on `ingredients`; meta only records the source.
      const ids = await resolveLibraryIdsForRows(estimate.ingredients);
      const { ingredients } = buildLibraryBackedIngredients(estimate.ingredients, ids);
      await createRecipe({
        name: estimate.mealName.trim() || 'Meal',
        serving_size: '1 meal',
        calories: totals.calories,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        fat_g: totals.fat,
        ingredients,
        meal_builder_meta: { source: 'ai_recipe' },
      });
      navigate(`/recipes?saved=${encodeURIComponent('Recipe saved — ingredient amounts are editable when you log it.')}`);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  const conf = estimate ? (CONFIDENCE_META[estimate.confidence] || CONFIDENCE_META.medium) : null;

  return (
    <div>
      {!inModal && (
        <Reveal>
          <h1 className="page-title" style={{ marginBottom: 6 }}>AI Estimate</h1>
          <p className="page-subtitle" style={{ marginBottom: 18 }}>
            Speak or type what you ate in plain language. We’ll jot it down — including matching a saved recipe if you name one.
          </p>
        </Reveal>
      )}

      {/* Input — hidden once a conversation is underway; the thread takes over */}
      {!estimate && !recipeReview && !picker && (
      <Reveal delay={60} className="card" style={{ marginBottom: 18 }}>
        <label htmlFor="ai-meal-desc">Speak or describe your meal</label>
        <div style={{ position: 'relative' }}>
          <textarea
            id="ai-meal-desc"
            ref={descRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              // ⌘/Ctrl + Enter generates the estimate; plain Enter stays a newline
              // so multi-line descriptions still work.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && description.trim() && !loading) {
                e.preventDefault();
                runEstimate('');
              }
            }}
            placeholder={PLACEHOLDER}
            rows={5}
            disabled={loading}
            style={{ width: '100%', resize: 'vertical', minHeight: 110, fontSize: '1rem', lineHeight: 1.5 }}
          />
          {/* Loading message floats over the box instead of pushing content down */}
          {loading && (
            <div className="modal-loading-overlay" style={{
              position: 'absolute', inset: 0, borderRadius: 8,
              background: 'rgba(255,255,255,0.82)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontSize: 14.5, fontWeight: 600, color: 'var(--color-text-body)',
            }}>
              <span className="btn-spinner" aria-hidden="true" style={{ marginRight: 0 }} />
              Give it a second — estimating…
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <VoiceInput
            onTranscript={text =>
              setDescription(d => (d.trim() ? `${d.trimEnd()}\n${text}` : text))
            }
          />
          <button
            type="button"
            className={loading ? 'btn-primary btn-loading' : 'btn-primary'}
            onClick={() => runEstimate('')}
            disabled={loading || !description.trim()}
            style={{ minHeight: 48, fontWeight: 700 }}
          >
            {loading
              ? (<><span className="btn-spinner" aria-hidden="true" />Estimating…</>)
              : 'Generate estimate'}
          </button>
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      </Reveal>
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
          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}

      {/* Recipe-log review (matched saved recipe) */}
      {recipeReview && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Log saved recipe</h3>

          <ConversationThread thread={thread} loading={loading} pendingLabel="Updating the recipe…" />

          <div style={{ padding: 12, background: 'var(--color-primary-subtle)', border: '1px solid var(--color-border)', borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary-ink)' }}>{recipeReview.recipe.name}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-primary)' }}>
              Matched from your saved recipes{recipeReview.matchConfidence ? ` · ${recipeReview.matchConfidence} confidence` : ''}.
            </div>
            {recipeReview.recipe.recipe_kind === 'limited' && recipeReview.recipe.remaining_uses != null && (
              <div className="prep-badge">
                Meal prep · {recipeReview.recipe.remaining_uses}
                {Number(recipeReview.recipe.max_uses) > 0 ? ` of ${recipeReview.recipe.max_uses}` : ''} serving
                {recipeReview.recipe.remaining_uses === 1 ? '' : 's'} left
                {(() => {
                  const made = recipeReview.recipe.created_at ? new Date(recipeReview.recipe.created_at).getTime() : NaN;
                  if (!Number.isFinite(made)) return '';
                  const d = Math.max(0, Math.floor((Date.now() - made) / 86400000));
                  return d === 0 ? ' · made today' : d === 1 ? ' · made yesterday' : ` · made ${d} days ago`;
                })()}
                <span className="prep-badge__hint">
                  Logging counts servings down; the template archives itself when the batch is gone.
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => useFreeformInstead(recipeReview.fallbackEstimate)}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--color-link)', textDecoration: 'underline' }}
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
          {recipeReview.keepable?.length > 0 && (
            <div style={{ padding: 12, background: 'var(--color-surface-muted, #f9fafb)', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-body)' }}>Keep this in the recipe?</div>
              <p style={{ margin: '2px 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                One-off by default. Keeping this adds the ingredient to the saved recipe.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recipeReview.keepable.map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: 13, color: 'var(--color-text-body)' }}>{item.label}</span>
                    {kept.includes(item.label) ? (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#065f46', flexShrink: 0 }}>✓ Saved to recipe</span>
                    ) : (
                      <button
                        type="button"
                        className={keepBusy === item.label ? 'btn-secondary btn-loading' : 'btn-secondary'}
                        onClick={() => keepChange(item)}
                        disabled={!!keepBusy}
                        style={{ minHeight: 36, padding: '0 14px', fontSize: 13, flexShrink: 0 }}
                      >
                        {keepBusy === item.label ? 'Saving…' : 'Keep in recipe'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <RecipeFixUpList items={recipeReview.unapplied} library={library} onResolve={resolveUnapplied} />

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
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13, alignItems: 'center' }}>
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
          <div style={{ padding: 12, background: '#0f3d2e', border: '1px solid #145239', borderRadius: 10 }}>
            <strong style={{ color: '#6ee7b7' }}>Totals</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#ecfdf5', fontWeight: 600 }}>
              {(() => {
                const t = recipeReview.requiresCustomPath
                  ? recipeReview.total
                  : (() => { const s = Number(recipeServings) > 0 ? Number(recipeServings) : 1; const ps = recipeReview.perServing; return { calories: (Number(ps.calories) || 0) * s, protein_g: (Number(ps.protein_g) || 0) * s, carbs_g: (Number(ps.carbs_g) || 0) * s, fat_g: (Number(ps.fat_g) || 0) * s }; })();
                return `${Math.round(t.calories)} cal · P ${t.protein_g.toFixed(1)}g · C ${t.carbs_g.toFixed(1)}g · F ${t.fat_g.toFixed(1)}g`;
              })()}
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="ai-recipe-log-date" style={{ margin: 0, fontSize: 13 }}>Log to</label>
            <input
              id="ai-recipe-log-date"
              type="date"
              value={logDate}
              onChange={e => setLogDate(e.target.value)}
              style={{ width: 170 }}
            />
          </div>
          {logDate && logDate !== getLocalDateISO() && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              Backfills {logDate} — you'll find it on that day in History.
            </p>
          )}
          {/* Follow-up — refine the swap without starting the description over */}
          <FollowUpComposer
            id="ai-recipe-follow-up"
            value={followUp}
            onChange={setFollowUp}
            onSend={runEstimate}
            loading={loading}
            placeholder="e.g. make it 200g sweet potato instead of the toast"
          />

          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className={busy === 'log' ? 'btn-primary btn-loading' : 'btn-primary'} onClick={logRecipe} disabled={busy !== '' || loading} style={{ minHeight: 48, fontWeight: 700 }}>
              {busy === 'log'
                ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>)
                : logDate && logDate !== getLocalDateISO() ? `Log recipe — ${logDate}` : 'Log recipe'}
            </button>
            <button type="button" className="btn-secondary" onClick={clearAll} disabled={busy !== ''}>Cancel</button>
          </div>
          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}

      {/* Review */}
      {estimate && (
        <div className="card" style={{ marginBottom: 18 }}>
          {/* Conversation so far — the description, the AI's replies, and every correction */}
          <ConversationThread thread={thread} loading={loading} />

          <h3 className="section-title" style={{ marginTop: 0 }}>Review estimate</h3>

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

          {/* Ingredient rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {estimate.ingredients.length === 0 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No ingredients were identified.</p>
            )}
            {estimate.ingredients.map((ing, idx) => {
              const meta = SOURCE_META[rowSourceKey(ing)];
              const basis = ing.basis || deriveBasis(ing, library);
              // A big gap between a saved/common source and the AI's own estimate
              // for the SAME amount usually means a dry/raw ↔ cooked weight
              // mismatch (e.g. dry-pasta macros applied to a cooked weight) — the
              // math is right but the basis isn't. Surface it so a ~2× overcount
              // can't slip through silently.
              const aiCal = n(ing.aiMacros?.calories);
              const shownCal = n(ing.calories);
              const sourceGap = (ing.source === 'library' || ing.source === 'common')
                && aiCal > 40 && shownCal > 40
                && (shownCal / aiCal >= 1.6 || aiCal / shownCal >= 1.6);
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
              const estimateLabel = ing.macroSource === 'provided' ? 'Provided in message' : 'AI estimate';
              const srcValue = ing.source === 'library' && ing.label_ingredient_id != null
                ? String(ing.label_ingredient_id)
                : (ing.overridden || ing.source === 'manual') ? 'manual' : 'estimate';
              return (
                <div
                  key={idx}
                  style={{
                    border: `1px solid ${meta.border}`,
                    borderLeft: `3px solid ${meta.color}`,
                    borderRadius: 8,
                    background: meta.bg,
                    overflow: 'hidden',
                  }}
                >
                  {/* --- Compact one-line summary; click anywhere to expand --- */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!!ing.expanded}
                    onClick={() => toggleRowPanel(idx)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRowPanel(idx); } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' }}
                  >
                    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-strong)', overflowWrap: 'anywhere' }}>{ing.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {ing.quantity ? `${fmt(ing.quantity)} ${ing.unit}`.trim() : ing.unit}
                        {STATE_LABELS[ing.state] ? ` · ${STATE_LABELS[ing.state]}` : ''}
                      </span>
                    </div>
                    <span
                      title={sourceGap ? `Saved data gives ${fmt(shownCal)} cal here, but a fresh estimate is ~${fmt(aiCal)} cal — check dry/raw vs cooked weight.` : undefined}
                      style={{ fontSize: 12.5, color: sourceGap ? '#b45309' : '#0f172a', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {sourceGap ? '⚠ ' : ''}<strong>{fmt(ing.calories)}</strong> cal · P{fmt(ing.protein)} C{fmt(ing.carbs)} F{fmt(ing.fat)}
                    </span>
                    <span
                      title={ing.overridden ? 'You edited these macros' : (meta.kind ? `From your ${meta.kind}${ing.matchedName ? `: ${ing.matchedName}` : ''}` : 'AI estimate — no saved or common match')}
                      style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: meta.color, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {ambiguous ? '⚠ ' : ''}{meta.short}
                    </span>
                    <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 11, color: 'var(--color-text-muted)', transform: ing.expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
                  </div>

                  {/* --- Expanded basis editor --- */}
                  {ing.expanded && (
                    <div style={{ padding: 10, background: '#fff', borderTop: `1px solid ${meta.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Ingredient source — one control: the AI estimate, a saved ingredient, or manual macros */}
                      <div style={{ background: '#f9fafb', border: '1px solid #eef0f3', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label htmlFor={`ai-source-${idx}`} style={{ fontSize: 12, fontWeight: 600, color: '#374151', margin: 0 }}>Ingredient source</label>
                        <select
                          id={`ai-source-${idx}`}
                          value={srcValue}
                          onChange={e => setRowSource(idx, e.target.value)}
                          style={{ width: '100%', fontSize: 13 }}
                        >
                          <option value="estimate">{estimateLabel}</option>
                          <option value="manual">Manual entry</option>
                          {options.length > 0 && (
                            <optgroup label={q ? 'Search results' : 'From your library'}>
                              {options.map(li => (
                                <option key={li.id} value={String(li.id)}>{li.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <input
                          value={ing.matchSearch || ''}
                          onChange={e => setRowSearch(idx, e.target.value)}
                          placeholder="Search your library for a saved ingredient…"
                          style={{ fontSize: 13 }}
                        />
                        {q && options.length === 0 && (
                          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                            No saved ingredient matches “{q}”.
                          </p>
                        )}
                        {ing.incompatible && (
                          <p style={{ margin: 0, fontSize: 11.5, color: '#92400e' }}>
                            Couldn’t auto-scale that saved item to “{ing.unit || 'this unit'}” — adjust the basis below.
                          </p>
                        )}
                      </div>
                      {sourceGap && (
                        <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12.5, color: '#92400e' }}>
                          Saved data gives <strong>{fmt(shownCal)} cal</strong> for {fmt(ing.quantity)} {ing.unit}, but a fresh estimate is ~<strong>{fmt(aiCal)} cal</strong>. A gap this large usually means the saved item’s macros are per <em>dry/raw</em> weight while you logged a <em>cooked</em> amount (or vice-versa). Use whichever matches what you actually ate.
                          <div style={{ marginTop: 8 }}>
                            <button type="button" className="btn-secondary" onClick={() => setRowSource(idx, 'estimate')} style={{ minHeight: 34, padding: '4px 12px', fontSize: 12.5 }}>
                              Use the estimate (~{fmt(aiCal)} cal)
                            </button>
                          </div>
                        </div>
                      )}
                      {ambiguous && (
                        <p style={{ margin: 0, fontSize: 11.5, color: '#92400e' }}>
                          Multiple saved matches — confirm which one you used.
                        </p>
                      )}
                      {ing.notes && (
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-faint)' }}>{ing.notes}</p>
                      )}

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
          <div style={{ marginTop: 16, padding: 12, background: '#0f3d2e', border: '1px solid #145239', borderRadius: 10 }}>
            <strong style={{ color: '#6ee7b7' }}>Totals{prep.isMealPrep ? ' — whole batch' : ''}</strong>
            <div style={{ marginTop: 4, fontSize: 15, color: '#ecfdf5', fontWeight: 600 }}>
              {Math.round(totals.calories)} cal · P {totals.protein.toFixed(1)}g · C {totals.carbs.toFixed(1)}g · F {totals.fat.toFixed(1)}g
            </div>
          </div>

          {/* ── Meal prep split explorer ── */}
          {prep.isMealPrep ? (
            <div className="prep-panel panel-in">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h4 className="prep-panel__title">Meal prep — per-serving split</h4>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPrep({ isMealPrep: false, servings: null })}
                  style={{ minHeight: 34, padding: '4px 12px', fontSize: 13 }}
                >
                  Not a meal prep
                </button>
              </div>
              <p style={{ margin: '6px 0 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                {prep.servings == null
                  ? 'How many servings are you splitting this batch into?'
                  : `Splitting into ${prep.servings} — each serving is highlighted below.`}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(prep.servings != null && ![2, 3, 4, 5, 6].includes(prep.servings)
                  ? [2, 3, 4, 5, 6, prep.servings].sort((a, b) => a - b)
                  : [2, 3, 4, 5, 6]
                ).map(nS => (
                  <button
                    key={nS}
                    type="button"
                    className={prep.servings === nS ? 'prep-split is-selected' : 'prep-split'}
                    onClick={() => setPrep(p => ({ ...p, servings: nS }))}
                  >
                    <span className="prep-split__count">÷ {nS} servings</span>
                    <span className="prep-split__macros">
                      {Math.round(totals.calories / nS)} cal · P {(totals.protein / nS).toFixed(1)}g · C {(totals.carbs / nS).toFixed(1)}g · F {(totals.fat / nS).toFixed(1)}g
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <label htmlFor="prep-servings" style={{ margin: 0, fontSize: 13 }}>Custom count:</label>
                <input
                  id="prep-servings"
                  type="number" min="2" max="50" step="1"
                  value={prep.servings ?? ''}
                  onChange={e => {
                    const v = Math.floor(Number(e.target.value));
                    setPrep(p => ({ ...p, servings: Number.isInteger(v) && v >= 2 && v <= 50 ? v : null }));
                  }}
                  style={{ width: 90 }}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPrep({ isMealPrep: true, servings: 4 })}
                style={{ width: '100%', minHeight: 48, fontWeight: 700 }}
              >
                This is a meal prep. Split into servings
              </button>
            </div>
          )}

          {/* Assumptions / warnings — inline and concise, no bullet lists */}
          {estimate.assumptions.length > 0 && (
            <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-text-body)' }}>Assumptions:</strong> {estimate.assumptions.join('; ')}
            </p>
          )}
          {estimate.warnings.length > 0 && (
            <p style={{ margin: '10px 0 0', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              <strong>Double-check:</strong> {estimate.warnings.join('; ')}
            </p>
          )}

          {/* Follow-up — keep the conversation going */}
          <FollowUpComposer
            id="ai-follow-up"
            value={followUp}
            onChange={setFollowUp}
            onSend={runEstimate}
            loading={loading}
            placeholder="e.g. the rice was dry weight, and I forgot a tbsp of olive oil"
          />

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {prep.isMealPrep && (
              <div>
                <button
                  type="button"
                  className={busy === 'prep' ? 'btn-primary btn-loading' : 'btn-primary'}
                  onClick={saveAsMealPrep}
                  disabled={busy !== '' || prep.servings == null || estimate.ingredients.length === 0}
                  style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
                >
                  {busy === 'prep'
                    ? (<><span className="btn-spinner" aria-hidden="true" />Saving meal prep…</>)
                    : `Save as meal prep${prep.servings != null ? ` (${prep.servings} servings)` : ''}`}
                </button>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {prep.servings == null
                    ? 'Pick a serving count in the split above to enable this.'
                    : `Saves a limited-use template with ${prep.servings} uses — each logged serving counts down until the batch is gone.`}
                </p>
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label htmlFor="ai-log-date" style={{ margin: 0, fontSize: 13 }}>Log to</label>
                <input
                  id="ai-log-date"
                  type="date"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  style={{ width: 170 }}
                />
              </div>
              {estimate.ingredients.length === 0 && (
                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#92400e' }}>
                  Nothing to log yet — add more detail in “Anything to adjust?” above and send.
                </p>
              )}
              {/* Log once + Save as recipe sit side by side to save vertical space */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={busy === 'log' ? 'btn-primary btn-loading' : 'btn-primary'}
                  onClick={logOnce}
                  disabled={busy !== '' || estimate.ingredients.length === 0}
                  style={{ flex: '1 1 0', minWidth: 130, minHeight: 52, fontSize: '1.05rem', fontWeight: 700, borderRadius: 12 }}
                >
                  {busy === 'log'
                    ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>)
                    : logDate && logDate !== getLocalDateISO() ? `Log once — ${logDate}` : 'Log once'}
                </button>
                <button
                  type="button"
                  className={busy === 'save' ? 'btn-secondary btn-loading' : 'btn-secondary'}
                  onClick={saveAsRecipe}
                  disabled={busy !== '' || estimate.ingredients.length === 0}
                  style={{ flex: '1 1 0', minWidth: 130, minHeight: 52, fontWeight: 700, borderRadius: 12 }}
                >
                  {busy === 'save' ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>) : 'Save as recipe'}
                </button>
              </div>
              {logDate && logDate !== getLocalDateISO() && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Backfills {logDate} — find it on that day in History.
                </p>
              )}
            </div>
            <button type="button" className="btn-secondary" onClick={clearAll} disabled={busy !== ''} style={{ alignSelf: 'flex-start' }}>
              Start over
            </button>
          </div>

          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
