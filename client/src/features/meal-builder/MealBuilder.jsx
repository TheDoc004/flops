import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeForm from './RecipeForm';
import IngredientCombobox from './IngredientCombobox';
import { LabelCropModal } from '@features/label-ocr';
import { createRecipe, fetchRecipe, updateRecipe } from '@shared/api/recipes';
import { createCustomLog } from '@shared/api/log';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { createLabelIngredient, fetchLabelIngredients, markLabelIngredientsUsed } from '@shared/api/labelIngredients';
import {
  extractTextFromLabelImage,
  parseNutritionFactsText,
  mergeNutritionParseIntoIngredientForm,
  scanFieldClass,
  macrosForLabelServingAmount,
  sumMacroObjects,
} from '@features/label-ocr';
import { SERVING_UNITS, isWeightUnit, servingToStored, emptyServing, unitLabel } from '@shared/utils/servingBasis';
import Reveal from '@shared/ui/Reveal';

function emptyLabelDraft() {
  return {
    name: '',
    brand_name: '',
    ...emptyServing(), // serving_amount, serving_unit, serving_unit_custom, gram_equivalent
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
    fiber_g: '',
    photoPreview: null,
    photoDataUri: null,
  };
}

function newLine() {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    roleLabel: '',
    labelIngredientId: '',
    amount: '',
    unit: 'g',
    substitute_label_ingredient_ids: [],
    slotId: null,
  };
}

function macroSummaryText(macros, { fiber = false } = {}) {
  const base = `${Math.round(macros.calories)} cal · P ${macros.protein_g.toFixed(1)}g · C ${macros.carbs_g.toFixed(1)}g · F ${macros.fat_g.toFixed(1)}g`;
  return fiber && macros.fiber_g > 0
    ? `${base} · Fiber ${macros.fiber_g.toFixed(1)}g`
    : base;
}

function getSuggestedSubstitutes(defaultIng, candidates) {
  if (!defaultIng || candidates.length === 0) {
    return [...candidates]
      .sort((a, b) => new Date(b.last_used_at || 0) - new Date(a.last_used_at || 0))
      .slice(0, 5);
  }
  const defName = (defaultIng.name || '').toLowerCase();
  const defBase = (defaultIng.base_label || '').toLowerCase();
  const scored = candidates.map(x => {
    const xName = (x.name || '').toLowerCase();
    const xBase = (x.base_label || '').toLowerCase();
    let score = 0;
    if (defBase && xBase && xBase === defBase) score += 3;
    if (defName && xName.includes(defName)) score += 2;
    if (defName && defName.includes(xName) && xName.length > 3) score += 1;
    if (x.last_used_at) score += 0.5;
    return { x, score };
  });
  const matched = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).map(r => r.x);
  if (matched.length >= 5) return matched.slice(0, 5);
  const matchedIds = new Set(matched.map(x => x.id));
  const filler = [...candidates]
    .filter(x => !matchedIds.has(x.id))
    .sort((a, b) => new Date(b.last_used_at || 0) - new Date(a.last_used_at || 0))
    .slice(0, 5 - matched.length);
  return [...matched, ...filler];
}

export default function MealBuilder() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'manual' ? 'manual' : 'labels';
  const recipeIdParam = searchParams.get('recipe_id');
  const recipeId = recipeIdParam && /^\d+$/.test(recipeIdParam) ? Number(recipeIdParam) : null;

  const [loadedRecipe, setLoadedRecipe] = useState(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [recipeLoadError, setRecipeLoadError] = useState('');

  const [savedLabels, setSavedLabels] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [labelDraft, setLabelDraft] = useState(emptyLabelDraft);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [labelSaveError, setLabelSaveError] = useState('');
  /** Non-blocking notes after OCR: partial parse, review reminders */
  const [labelScanFeedback, setLabelScanFeedback] = useState(null);
  /** Per-field hints from last scan: missing / uncertain */
  const [labelScanFieldStatus, setLabelScanFieldStatus] = useState(null);
  const [labelCropOpen, setLabelCropOpen] = useState(false);
  const [lines, setLines] = useState([newLine()]);
  const [mealName, setMealName] = useState('');
  const [mealSaveError, setMealSaveError] = useState('');
  const [mealSaved, setMealSaved] = useState(false);
  const [mealLoggedOnce, setMealLoggedOnce] = useState(false);
  const [loggingOnce, setLoggingOnce] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  // Mobile only: which ingredient rows have the collapsed "More options" (role + substitutes) open.
  const [expandedLines, setExpandedLines] = useState(() => new Set());
  function toggleLineExpanded(id) {
    setExpandedLines(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const roleLabelRefs = useRef({});
  const comboboxRefs = useRef({});
  const amountRefs = useRef({});
  const [pendingFocusLineId, setPendingFocusLineId] = useState(null);
  const backToDashboardRef = useRef(null);
  const libCardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!recipeId) {
      setLoadedRecipe(null);
      setRecipeLoadError('');
      return undefined;
    }
    setLoadingRecipe(true);
    setRecipeLoadError('');
    (async () => {
      try {
        const r = await fetchRecipe(recipeId);
        if (!cancelled) setLoadedRecipe(r);
      } catch (e) {
        if (!cancelled) setRecipeLoadError(e.message);
      } finally {
        if (!cancelled) setLoadingRecipe(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId]);

  const reloadLabels = useCallback(async () => {
    setLoadError('');
    try {
      setSavedLabels(await fetchLabelIngredients());
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  function redirectToStep1ForCreate(prefillName) {
    setLibOpen(true);
    if (prefillName) {
      setLabelDraft(d => ({ ...d, name: prefillName }));
      setLabelSaveError('');
    }
    requestAnimationFrame(() => {
      libCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  useEffect(() => {
    void reloadLabels();
  }, [reloadLabels]);

  const ingById = useMemo(() => Object.fromEntries(savedLabels.map(x => [String(x.id), x])), [savedLabels]);

  const sortedLabels = useMemo(
    () => [...savedLabels].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })),
    [savedLabels]
  );

  // If editing a label-built recipe, prefill from its meal_builder_meta lines.
  useEffect(() => {
    if (mode !== 'labels') return;
    if (!loadedRecipe || !recipeId) return;
    const meta = loadedRecipe.meal_builder_meta;
    if (!meta || typeof meta !== 'object' || meta.source !== 'meal_builder' || !Array.isArray(meta.lines)) return;
    const nextLines = meta.lines
      .filter(x => x && x.label_ingredient_id != null)
      .map(x => ({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
        roleLabel: x.role_label != null ? String(x.role_label) : '',
        labelIngredientId: String(x.label_ingredient_id),
        amount: x.amount != null ? String(x.amount) : '',
        unit: x.unit || 'g',
        substitute_label_ingredient_ids: Array.isArray(x.substitute_label_ingredient_ids)
          ? x.substitute_label_ingredient_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
          : [],
        slotId: x.slot_id != null ? String(x.slot_id) : null,
      }));
    if (nextLines.length) setLines(nextLines);
    setMealName(loadedRecipe.name || '');
  }, [mode, loadedRecipe, recipeId]);

  useEffect(() => {
    if (!pendingFocusLineId) return;
    const el = roleLabelRefs.current[pendingFocusLineId];
    if (el) {
      el.focus();
      setPendingFocusLineId(null);
    }
  }, [pendingFocusLineId, lines]);

  useEffect(() => {
    if (!mealSaved && !mealLoggedOnce) return;
    requestAnimationFrame(() => {
      backToDashboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [mealSaved, mealLoggedOnce]);

  const lineMacros = useMemo(() => {
    return lines.map(line => {
      const ing = ingById[line.labelIngredientId];
      if (!ing || line.amount === '' || line.amount == null) return null;
      return macrosForLabelServingAmount(ing, line.amount, line.unit);
    });
  }, [lines, ingById]);

  const totals = useMemo(() => sumMacroObjects(lineMacros.filter(Boolean)), [lineMacros]);

  async function onPickLabelPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      const uri = typeof reader.result === 'string' ? reader.result : null;
      setLabelDraft(d => ({ ...d, photoPreview: uri, photoDataUri: uri }));
    };
    reader.readAsDataURL(file);
  }

  async function runOcr() {
    if (!labelDraft.photoPreview) return;
    setOcrBusy(true);
    setLabelSaveError('');
    setLabelScanFeedback(null);
    setLabelScanFieldStatus(null);
    try {
      const blob = await (await fetch(labelDraft.photoPreview)).blob();
      const ocr = await extractTextFromLabelImage(blob);
      const text = ocr.ok ? String(ocr.text || '') : '';
      const parsed = parseNutritionFactsText(text);
      const prev = {
        name: labelDraft.name,
        brand_name: labelDraft.brand_name,
        serving_size_text: '',
        grams_per_serving: '',
        calories: labelDraft.calories,
        protein_g: labelDraft.protein_g,
        carbs_g: labelDraft.carbs_g,
        fat_g: labelDraft.fat_g,
        fiber_g: labelDraft.fiber_g,
      };
      const { next, scanFeedback, fieldStatus } = mergeNutritionParseIntoIngredientForm(prev, parsed);
      setLabelDraft(d => ({
        ...d,
        name: next.name,
        brand_name: next.brand_name,
        calories: next.calories,
        protein_g: next.protein_g,
        carbs_g: next.carbs_g,
        fat_g: next.fat_g,
        fiber_g: next.fiber_g,
        ...(next.grams_per_serving != null && next.grams_per_serving !== ''
          ? { serving_amount: String(next.grams_per_serving), serving_unit: 'g', serving_unit_custom: '' }
          : {}),
      }));
      const messages = [];
      if (ocr.errorMessage) messages.push(ocr.errorMessage);
      if (scanFeedback?.length) messages.push(...scanFeedback);
      setLabelScanFeedback(messages.length ? messages : null);
      setLabelScanFieldStatus(fieldStatus);
      if (!ocr.ok) setLabelSaveError('');
    } finally {
      setOcrBusy(false);
    }
  }

  function clearLabelScanHints() {
    setLabelScanFieldStatus(null);
  }

  async function saveLabelIngredient(e) {
    e.preventDefault();
    setLabelSaveError('');
    const name = labelDraft.name.trim();
    const brand_name = labelDraft.brand_name.trim();
    if (!name) {
      setLabelSaveError('Name is required.');
      return;
    }
    const stored = servingToStored(labelDraft);
    try {
      await createLabelIngredient({
        name,
        brand_name: brand_name || undefined,
        serving_size_text: stored.serving_size_text,
        grams_per_serving: stored.grams_per_serving,
        calories: Number(labelDraft.calories),
        protein_g: Number(labelDraft.protein_g),
        carbs_g: Number(labelDraft.carbs_g),
        fat_g: Number(labelDraft.fat_g),
        fiber_g: labelDraft.fiber_g === '' ? undefined : Number(labelDraft.fiber_g),
        tracking_type: stored.tracking_type,
        unit_name: stored.unit_name,
        serving_quantity: stored.serving_quantity,
        grams_per_unit: stored.grams_per_unit,
        photo_data_uri: labelDraft.photoDataUri && labelDraft.photoDataUri.length < 350_000 ? labelDraft.photoDataUri : undefined,
        source_type: labelDraft.photoDataUri ? 'scanned_label' : 'manual',
      });
      setLabelDraft(emptyLabelDraft());
      await reloadLabels();
    } catch (err) {
      setLabelSaveError(err.message);
    }
  }

  function updateLine(id, patch) {
    setLines(prev =>
      prev.map(l => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, 'labelIngredientId')) {
          const def = Number(patch.labelIngredientId);
          next.substitute_label_ingredient_ids = (next.substitute_label_ingredient_ids || []).filter(x => x !== def);
        }
        return next;
      })
    );
  }

  function addSubstituteToLine(lineId, labelIngredientId) {
    const id = Number(labelIngredientId);
    if (!Number.isInteger(id) || id <= 0) return;
    setLines(prev =>
      prev.map(l => {
        if (l.id !== lineId) return l;
        const def = Number(l.labelIngredientId);
        if (!def || id === def) return l;
        if ((l.substitute_label_ingredient_ids || []).includes(id)) return l;
        return { ...l, substitute_label_ingredient_ids: [...(l.substitute_label_ingredient_ids || []), id] };
      })
    );
  }

  function removeSubstituteFromLine(lineId, labelIngredientId) {
    setLines(prev =>
      prev.map(l =>
        l.id === lineId
          ? { ...l, substitute_label_ingredient_ids: (l.substitute_label_ingredient_ids || []).filter(x => x !== labelIngredientId) }
          : l
      )
    );
  }

  function handleRoleKeyDown(e, lineId) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    comboboxRefs.current[lineId]?.focus();
  }

  function handleIngredientSelect(lineId) {
    amountRefs.current[lineId]?.focus();
  }

  function handleAmountKeyDown(e, lineId, idx) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!lines[idx]?.labelIngredientId) return;
    const nextLine = lines[idx + 1];
    if (nextLine) {
      roleLabelRefs.current[nextLine.id]?.focus();
    } else {
      const newL = newLine();
      setLines(prev => [...prev, newL]);
      setPendingFocusLineId(newL.id);
    }
  }

  function newSlotId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  }

  async function saveMeal(e) {
    e.preventDefault();
    setMealSaveError('');
    setMealSaved(false);
    const name = mealName.trim();
    if (!name) {
      setMealSaveError('Meal name is required.');
      return;
    }
    const ingRows = [];
    for (const line of lines) {
      const ing = ingById[line.labelIngredientId];
      if (!ing) continue;
      const m = macrosForLabelServingAmount(ing, line.amount, line.unit);
      if (!m) {
        setMealSaveError(
          ing.tracking_type === 'unit'
            ? `Enter a valid count for "${ing.name}".`
            : `Check amounts and grams/serving for "${ing.name}". Each saved label needs grams per serving to scale your portion.`
        );
        return;
      }
      const subs = (line.substitute_label_ingredient_ids || [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0 && n !== ing.id);
      ingRows.push({
        ing,
        m,
        amount: line.amount,
        unit: line.unit,
        roleLabel: String(line.roleLabel || '').trim(),
        subs,
        slotId: line.slotId || null,
      });
    }
    if (ingRows.length === 0) {
      setMealSaveError('Add at least one ingredient with a valid amount.');
      return;
    }
    const t = sumMacroObjects(ingRows.map(x => x.m));
    const ingredients = [];
    for (const x of ingRows) {
      const slot_id = x.slotId || newSlotId();
      x.resolvedSlotId = slot_id;
      ingredients.push({
        kind: 'slot',
        slot_id,
        label: x.roleLabel || x.ing.name,
        amount: String(x.amount),
        unit: x.ing.tracking_type === 'unit' ? (x.ing.unit_name || '') : (x.unit === 'oz' ? 'oz' : 'g'),
        option_label_ingredient_ids: x.subs.length > 0 ? [x.ing.id, ...x.subs] : [x.ing.id],
      });
    }
    const meal_builder_meta = {
      source: 'meal_builder',
      lines: ingRows.map(x => ({
        label_ingredient_id: x.ing.id,
        name: x.ing.name,
        role_label: x.roleLabel || null,
        brand_name: x.ing.brand_name || null,
        amount: Number(x.amount),
        unit: x.unit,
        slot_id: x.resolvedSlotId,
        ...(x.subs.length > 0 ? { substitute_label_ingredient_ids: x.subs } : {}),
      })),
    };
    try {
      const body = {
        name,
        serving_size: '1 meal',
        calories: Math.round(t.calories * 10) / 10,
        protein_g: Math.round(t.protein_g * 100) / 100,
        carbs_g: Math.round(t.carbs_g * 100) / 100,
        fat_g: Math.round(t.fat_g * 100) / 100,
        fiber_g: t.fiber_g > 0 ? Math.round(t.fiber_g * 100) / 100 : undefined,
        ingredients,
        meal_builder_meta,
      };
      if (recipeId) {
        await updateRecipe(recipeId, body);
      } else {
        await createRecipe(body);
      }
      // Ingredient memory: mark used (recent + frequent)
      const usedIds = [...new Set(ingRows.flatMap(x => [x.ing.id, ...x.subs]))];
      if (usedIds.length) {
        try { await markLabelIngredientsUsed(usedIds); } catch { /* non-blocking */ }
        await reloadLabels();
      }
      setMealSaved(true);
      if (!recipeId) {
        setMealName('');
        setLines([newLine()]);
      }
    } catch (err) {
      setMealSaveError(err.message);
    }
  }

  async function logOnceMeal() {
    if (loggingOnce) return; // guard against double-submit (rapid clicks)
    setMealSaveError('');
    setMealSaved(false);
    setMealLoggedOnce(false);
    const name = mealName.trim();
    if (!name) {
      setMealSaveError('Meal name is required.');
      return;
    }
    const validLines = lineMacros.filter(Boolean);
    if (validLines.length === 0) {
      setMealSaveError('Add at least one ingredient with a valid amount.');
      return;
    }
    const t = sumMacroObjects(validLines);
    setLoggingOnce(true);
    try {
      // Ingredient rows (with per-line macros) so the server persists the
      // breakdown AND estimates micronutrients (name/amount/unit).
      const ingredients = lines
        .map((l, idx) => {
          const ing = ingById[l.labelIngredientId];
          const amt = Number(l.amount);
          const mm = lineMacros[idx];
          if (!ing || !ing.name || !Number.isFinite(amt) || !mm) return null;
          return {
            name: ing.name,
            amount: amt,
            unit: l.unit,
            calories: mm.calories,
            protein_g: mm.protein_g,
            carbs_g: mm.carbs_g,
            fat_g: mm.fat_g,
            fiber_g: mm.fiber_g,
            source: 'library',
            label_ingredient_id: ing.id,
          };
        })
        .filter(Boolean);
      await createCustomLog({
        date: getLocalDateISO(),
        name,
        calories: Math.round(t.calories * 10) / 10,
        protein_g: Math.round(t.protein_g * 100) / 100,
        carbs_g: Math.round(t.carbs_g * 100) / 100,
        fat_g: Math.round(t.fat_g * 100) / 100,
        fiber_g: t.fiber_g > 0 ? Math.round(t.fiber_g * 100) / 100 : undefined,
        ...(ingredients.length ? { ingredients } : {}),
      });
      const usedIds = [...new Set(lines.map(l => Number(l.labelIngredientId)).filter(n => Number.isInteger(n) && n > 0))];
      if (usedIds.length) {
        try { await markLabelIngredientsUsed(usedIds); } catch { /* non-blocking */ }
        await reloadLabels();
      }
      setMealLoggedOnce(true);
      setMealName('');
      setLines([newLine()]);
    } catch (err) {
      setMealSaveError(err.message);
    } finally {
      setLoggingOnce(false); // re-enable (button stays on the page after logging)
    }
  }

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Meal Builder</h1>
        <p className="page-subtitle" style={{ marginBottom: 14 }}>
          Build meals and recipes from saved ingredients. Browse and log finished recipes from the <Link to="/recipes" style={{ color: 'var(--color-link)' }}>Recipe Library</Link>.
        </p>
      </Reveal>

      <Reveal delay={60} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          type="button"
          className={mode === 'labels' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('mode', 'labels');
            setSearchParams(next);
          }}
        >
          Smart Meal Builder
        </button>
        <button
          type="button"
          className={mode === 'manual' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('mode', 'manual');
            setSearchParams(next);
          }}
        >
          Manual recipe
        </button>
        {recipeId && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/meal-builder')}
            title="Stop editing"
          >
            Exit edit
          </button>
        )}
      </Reveal>

      {recipeLoadError && <p className="error">{recipeLoadError}</p>}

      {mode === 'manual' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">
            {recipeId ? 'Edit recipe (manual)' : 'New recipe (manual)'}
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Enter a meal directly (no saved ingredients needed). {recipeId ? 'Save your changes below.' : 'Log it once, or save it as a reusable recipe.'}
          </p>
          {loadingRecipe && recipeId ? (
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : (
            <RecipeForm
              key={recipeId ? `edit-${recipeId}` : 'manual-new'}
              initial={recipeId && loadedRecipe ? { ...loadedRecipe, fiber_g: loadedRecipe.fiber_g ?? '' } : undefined}
              submitLabel={recipeId ? 'Save changes' : 'Save as recipe'}
              onCancel={() => navigate('/recipes')}
              onLogOnce={recipeId ? undefined : async (payload) => {
                await createCustomLog({ date: getLocalDateISO(), ...payload });
                navigate('/', { state: { scrollToTop: true } });
              }}
              onSubmit={async (data) => {
                if (recipeId) {
                  await updateRecipe(recipeId, data);
                  navigate(`/recipes?saved=${encodeURIComponent('Recipe updated.')}`);
                } else {
                  await createRecipe(data);
                  navigate(`/recipes?saved=${encodeURIComponent('Recipe created.')}`);
                }
              }}
            />
          )}
        </div>
      )}

      {mode === 'labels' && (
        <>

      {loadError && <p className="error">{loadError}</p>}

      <Reveal delay={120}>
      <div ref={libCardRef} className="card" style={{ marginBottom: 20, scrollMarginTop: 120 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 className="section-title">1. Add ingredients to your library if you need to</h3>
          <button type="button" className="btn-secondary" style={{ flexShrink: 0 }} onClick={() => setLibOpen(o => !o)}>
            {libOpen ? 'Collapse' : '+ Add ingredient'}
          </button>
        </div>
        {!libOpen && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Save an ingredient once, then reuse it whenever you build meals or recipes.
          </p>
        )}
        {libOpen && (<>
        <p style={{ margin: '12px 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Add an ingredient once, then reuse it when building meals and recipes.{' '}
          <strong>Scan:</strong> photos are preprocessed and read locally with Tesseract.js — values are hints, compare with the package before saving.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Label photo</label>
          <input type="file" accept="image/*" onChange={onPickLabelPhoto} />
          {labelDraft.photoPreview && (
            <div style={{ marginTop: 10 }}>
              <img src={labelDraft.photoPreview} alt="Label preview" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn-secondary" disabled={ocrBusy} onClick={() => void runOcr()}>
                  {ocrBusy ? 'Reading…' : 'Read label (OCR)'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setLabelCropOpen(true)}>
                  Crop to nutrition panel
                </button>
              </div>
              {labelScanFeedback && labelScanFeedback.length > 0 && (
                <div
                  role="status"
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: '#92400e',
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: 8,
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: 6 }}>Review scan</strong>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {labelScanFeedback.map((msg, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <form onSubmit={saveLabelIngredient} className="form-grid-2">
          {/* Name + brand */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Product / ingredient name</label>
            <input value={labelDraft.name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, name: e.target.value })); }} placeholder="e.g. Greek yogurt" required />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Brand <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
            <input value={labelDraft.brand_name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, brand_name: e.target.value })); }} placeholder="e.g. Fage, Chobani" />
          </div>

          {/* Serving & scaling */}
          <div style={{ gridColumn: '1 / -1', paddingTop: 12, borderTop: '1px solid #f0ede8' }}>
            <div style={{ marginBottom: 4, fontSize: 14, fontWeight: 600, color: 'var(--color-text-body)' }}>Serving &amp; scaling</div>
            <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--color-text-faint)' }}>
              Serving size from the label — 170 g, 1 cup, 1 slice, 1 scoop, 1 egg, etc.
            </p>
          </div>
          <div>
            <label htmlFor="mb-serving-amount">Serving amount</label>
            <input
              id="mb-serving-amount"
              type="number" min="0" step="0.01"
              className={scanFieldClass(labelScanFieldStatus?.grams_per_serving)}
              value={labelDraft.serving_amount}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, serving_amount: e.target.value })); }}
              placeholder="1"
            />
          </div>
          <div>
            <label htmlFor="mb-serving-unit">Serving unit</label>
            <select
              id="mb-serving-unit"
              value={labelDraft.serving_unit}
              onChange={e => setLabelDraft(d => ({ ...d, serving_unit: e.target.value }))}
            >
              {SERVING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              <option value="custom">custom…</option>
            </select>
          </div>
          {labelDraft.serving_unit === 'custom' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="mb-unit-custom">Unit name</label>
              <input
                id="mb-unit-custom"
                value={labelDraft.serving_unit_custom}
                onChange={e => setLabelDraft(d => ({ ...d, serving_unit_custom: e.target.value }))}
                placeholder="e.g. bar, packet, bagel"
              />
            </div>
          )}
          {!isWeightUnit(labelDraft.serving_unit) && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="mb-gram-equiv">
                1 {unitLabel(labelDraft)} = grams <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="mb-gram-equiv"
                type="number" min="0" step="0.01"
                value={labelDraft.gram_equivalent}
                onChange={e => setLabelDraft(d => ({ ...d, gram_equivalent: e.target.value }))}
                placeholder="e.g. 31"
              />
              <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-faint)' }}>
                Optional — weight of one {unitLabel(labelDraft)} for more precise scaling.
              </p>
            </div>
          )}

          {/* Macros */}
          <div className="form-grid-2" style={{ gridColumn: '1 / -1' }}>
            <div>
              <label>Calories</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.calories)} value={labelDraft.calories} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, calories: e.target.value })); }} required />
            </div>
            <div>
              <label>Protein (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.protein_g)} value={labelDraft.protein_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, protein_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Carbs (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.carbs_g)} value={labelDraft.carbs_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, carbs_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Fat (g)</label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.fat_g)} value={labelDraft.fat_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fat_g: e.target.value })); }} required />
            </div>
            <div>
              <label>Fiber (g) <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontWeight: 400 }}>(optional)</span></label>
              <input type="number" min="0" step="0.1" className={scanFieldClass(labelScanFieldStatus?.fiber_g)} value={labelDraft.fiber_g} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fiber_g: e.target.value })); }} placeholder="Optional" />
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary">Save ingredient</button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setLabelDraft(emptyLabelDraft());
                setLabelScanFeedback(null);
                setLabelScanFieldStatus(null);
              }}
            >
              Clear form
            </button>
          </div>
        </form>
        {labelSaveError && <p className="error">{labelSaveError}</p>}
        </>)}
      </div>
      </Reveal>

      <Reveal className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">2. Build your meal from saved ingredients</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Pick ingredients from your library, enter the amount you're using, and the macros will calculate automatically.
        </p>
        {savedLabels.length > 0 && (() => {
          const withHistory = [...savedLabels]
            .filter(s => s.last_used_at)
            .sort((a, b) => new Date(b.last_used_at) - new Date(a.last_used_at))
            .slice(0, 8);
          const chips = withHistory.length > 0 ? withHistory : sortedLabels.slice(0, 8);
          const chipLabel = withHistory.length > 0 ? 'Recently Used' : 'Quick Add';
          return (
            <div className="mb-recently-used" style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {chipLabel}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {chips.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      const ingId = String(s.id);
                      setLines(prev => {
                        const firstEmpty = prev.findIndex(l => !l.labelIngredientId);
                        let next;
                        if (firstEmpty !== -1) {
                          next = prev.map((l, i) => i === firstEmpty ? { ...l, labelIngredientId: ingId } : l);
                        } else {
                          next = [...prev, { ...newLine(), labelIngredientId: ingId }];
                        }
                        if (next[next.length - 1].labelIngredientId) {
                          next = [...next, newLine()];
                        }
                        return next;
                      });
                    }}
                    style={{
                      background: '#eef2ff',
                      border: '1px solid #c7d2fe',
                      borderRadius: 20,
                      padding: '6px 12px',
                      fontSize: 13,
                      color: '#3730a3',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      lineHeight: 1.4,
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
        {lines.map((line, idx) => {
          const m = lineMacros[idx];
          return (
            <div key={line.id} className={`mb-line${expandedLines.has(line.id) ? ' is-expanded' : ''}`} style={{ marginBottom: 12 }}>
              <div className="mb-line-header">
                <span className="mb-line-title">Ingredient {idx + 1}</span>
                <button
                  type="button"
                  className="mb-trash"
                  onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))}
                  disabled={lines.length <= 1}
                  aria-label="Remove ingredient"
                  title="Remove ingredient"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              <div className="mb-line-row">
                <div className="mb-role-desktop">
                  <label style={{ fontSize: 12 }}>Role label</label>
                  <input
                    ref={el => { if (el) roleLabelRefs.current[line.id] = el; else delete roleLabelRefs.current[line.id]; }}
                    value={line.roleLabel}
                    onChange={e => updateLine(line.id, { roleLabel: e.target.value })}
                    onKeyDown={e => handleRoleKeyDown(e, line.id)}
                    placeholder="e.g. Yogurt"
                  />
                </div>
                <div className="mb-field-ingredient">
                  <IngredientCombobox
                    ref={el => { if (el) comboboxRefs.current[line.id] = el; else delete comboboxRefs.current[line.id]; }}
                    label="Ingredient (default)"
                    items={savedLabels}
                    value={line.labelIngredientId}
                    onChange={(next) => updateLine(line.id, { labelIngredientId: next })}
                    placeholder="Search ingredients…"
                    allowCreate
                    onRequestCreate={q => redirectToStep1ForCreate(q)}
                    onSelect={() => handleIngredientSelect(line.id)}
                  />
                </div>
                <div className="mb-amount-unit">
                <div className="mb-field-amount">
                  <label style={{ fontSize: 12 }}>Amount</label>
                  <input
                    ref={el => { if (el) amountRefs.current[line.id] = el; else delete amountRefs.current[line.id]; }}
                    type="number" min="0.01" step="0.01"
                    value={line.amount}
                    onChange={e => updateLine(line.id, { amount: e.target.value })}
                    onKeyDown={e => handleAmountKeyDown(e, line.id, idx)}
                  />
                </div>
                <div className="mb-field-unit">
                  <label style={{ fontSize: 12 }}>Unit</label>
                  {ingById[line.labelIngredientId]?.tracking_type === 'unit'
                    ? (
                      <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--color-text-body)', paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ingById[line.labelIngredientId]?.unit_name || 'unit'}
                      </div>
                    ) : (
                      <select value={line.unit} onChange={e => updateLine(line.id, { unit: e.target.value })}>
                        <option value="g">g</option>
                        <option value="oz">oz</option>
                      </select>
                    )
                  }
                </div>
                </div>
                <button type="button" className="btn-secondary mb-remove" onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))} disabled={lines.length <= 1}>Remove</button>
              </div>

              <button
                type="button"
                className="mb-more-toggle"
                onClick={() => toggleLineExpanded(line.id)}
                aria-expanded={expandedLines.has(line.id)}
              >
                {expandedLines.has(line.id) ? '▲ Fewer options' : '▾ Role label & substitutes'}
              </button>

              <div className="mb-advanced" style={{ marginTop: 8 }}>
                <div className="mb-role-mobile">
                  <label style={{ fontSize: 12 }}>Role label</label>
                  <input
                    value={line.roleLabel}
                    onChange={e => updateLine(line.id, { roleLabel: e.target.value })}
                    placeholder="e.g. Yogurt"
                  />
                </div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Substitutes (optional)</label>
                <p style={{ margin: '4px 0 6px', fontSize: 12, color: 'var(--color-text-faint)' }}>
                  Add a few ingredients you might swap in later.
                </p>
                {(line.substitute_label_ingredient_ids || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {(line.substitute_label_ingredient_ids || []).map(oid => {
                      const li = ingById[String(oid)];
                      return (
                        <span
                          key={oid}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            background: '#eef2ff',
                            borderRadius: 6,
                            fontSize: 13,
                          }}
                        >
                          {li ? li.name : `#${oid}`}
                          <button
                            type="button"
                            aria-label="Remove substitute"
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                            onClick={() => removeSubstituteFromLine(line.id, oid)}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {line.labelIngredientId ? (() => {
                  const defaultIng = ingById[line.labelIngredientId];
                  const alreadyAdded = new Set([
                    Number(line.labelIngredientId),
                    ...(line.substitute_label_ingredient_ids || []),
                  ]);
                  const subCandidates = savedLabels.filter(x => !alreadyAdded.has(x.id));
                  const subSuggestions = getSuggestedSubstitutes(defaultIng, subCandidates);
                  return (
                    <IngredientCombobox
                      label=""
                      items={subCandidates}
                      value=""
                      onChange={id => addSubstituteToLine(line.id, id)}
                      placeholder="Search saved ingredients…"
                      suggestions={subSuggestions}
                    />
                  );
                })() : (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-faint)' }}>Choose a default ingredient first.</p>
                )}
              </div>
              {m && (
                <div className="mb-macro" style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  This row: {macroSummaryText(m)}
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="btn-secondary" onClick={() => setLines(prev => [...prev, newLine()])}>+ Add ingredient row</button>

        <div style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <strong>Meal totals</strong>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            {macroSummaryText(totals, { fiber: true })}
          </div>
        </div>
      </Reveal>

      <Reveal>
      <form className="card" onSubmit={saveMeal}>
        <h3 className="section-title">{recipeId ? '3. Save your changes' : '3. Log it once, or save it as a recipe'}</h3>
        {recipeId && (
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Editing recipe #{recipeId}. Saving will update the existing recipe.
          </p>
        )}
        <div style={{ marginBottom: 12 }}>
          <label>Meal name</label>
          <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="e.g. Meal prep bowl #1" required />
        </div>
        {mealSaveError && <p className="error">{mealSaveError}</p>}
        {mealSaved && (
          <p style={{ color: 'var(--color-success)', fontSize: 14 }}>
            Saved to your library. <Link to="/recipes" style={{ color: 'var(--color-link)' }}>Open Recipe Library</Link>
          </p>
        )}
        {mealLoggedOnce && (
          <p style={{ color: 'var(--color-success)', fontSize: 14 }}>
            Logged to today. It&apos;s in your daily log — not saved to your Recipe Library.
          </p>
        )}
        {recipeId ? (
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', minHeight: 72, fontSize: '1.25rem', fontWeight: 700, marginTop: 16, borderRadius: 14, letterSpacing: '-0.01em' }}
          >
            Save changes
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <div>
              <button
                type="button"
                onClick={logOnceMeal}
                className="btn-secondary"
                disabled={loggingOnce}
                style={{ width: '100%', minHeight: 60, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                {loggingOnce ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>) : 'Log once'}
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Track this meal today without saving it to your recipe library.
              </p>
            </div>
            <div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', minHeight: 60, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
              >
                Save as recipe
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Add this to your recipe library so you can reuse it later.
              </p>
            </div>
          </div>
        )}
        {(mealSaved || mealLoggedOnce) && (
          <button
            ref={backToDashboardRef}
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/', { state: { scrollToTop: true } })}
            style={{
              width: '100%',
              minHeight: 64,
              fontSize: '1.15rem',
              fontWeight: 700,
              marginTop: 12,
              borderRadius: 14,
              letterSpacing: '-0.01em',
            }}
          >
            Back to Dashboard
          </button>
        )}
      </form>
      </Reveal>
        </>
      )}

      <LabelCropModal
        key={labelCropOpen ? labelDraft.photoPreview || 'open' : 'closed'}
        open={labelCropOpen}
        imageSrc={labelDraft.photoPreview}
        onClose={() => setLabelCropOpen(false)}
        onApply={uri => {
          setLabelCropOpen(false);
          setLabelDraft(d => ({ ...d, photoPreview: uri, photoDataUri: uri }));
          setLabelScanFeedback(null);
          setLabelScanFieldStatus(null);
        }}
      />

    </div>
  );
}
