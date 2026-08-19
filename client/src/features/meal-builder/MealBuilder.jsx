import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeForm from './RecipeForm';
import WizardStepper from './WizardStepper';
import StepIngredients from './StepIngredients';
import StepBuild from './StepBuild';
import StepReview from './StepReview';
import { emptyLabelDraft, newLine } from './builderUtils';
import { LabelCropModal } from '@features/label-ocr';
import { createRecipe, fetchRecipe, updateRecipe } from '@shared/api/recipes';
import { createCustomLog } from '@shared/api/log';
import { getLocalDateISO } from '@shared/utils/dateLocal';
import { createLabelIngredient, fetchLabelIngredients, markLabelIngredientsUsed } from '@shared/api/labelIngredients';
import {
  extractTextFromLabelImage,
  parseNutritionFactsText,
  mergeNutritionParseIntoIngredientForm,
  macrosForLabelServingAmount,
  sumMacroObjects,
} from '@features/label-ocr';
import { servingToStored } from '@shared/utils/servingBasis';
import Reveal from '@shared/ui/Reveal';

const WIZARD_STEPS = ['ingredients', 'build', 'save'];

export default function MealBuilder() {
  const navigate = useNavigate();
  const location = useLocation();
  /**
   * Where "Exit edit" returns to. Captured ONCE on mount: switching mode or
   * step calls setSearchParams, which pushes a fresh history entry carrying no
   * state, so reading location.state later would come back empty. Falls back to
   * the Recipe Library when the builder was opened directly (deep link or
   * refresh) and there's no origin to return to.
   */
  const [returnTo] = useState(() => location.state?.from || '/recipes');
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'manual' ? 'manual' : 'labels';
  const recipeIdParam = searchParams.get('recipe_id');
  const recipeId = recipeIdParam && /^\d+$/.test(recipeIdParam) ? Number(recipeIdParam) : null;

  // Wizard step lives in the URL so browser back and refresh keep your place.
  // The main flow is build → save; 'ingredients' is an optional detour for
  // adding to the library, reached from the build step.
  const stepParam = searchParams.get('step');
  const step = WIZARD_STEPS.includes(stepParam) ? stepParam : 'build';

  const goToStep = useCallback((next) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('step', next);
      return p;
    });
  }, [setSearchParams]);

  const [loadedRecipe, setLoadedRecipe] = useState(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [recipeLoadError, setRecipeLoadError] = useState('');

  const [savedLabels, setSavedLabels] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [labelDraft, setLabelDraft] = useState(emptyLabelDraft);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [labelSaveError, setLabelSaveError] = useState('');
  const [lastSavedIngredientName, setLastSavedIngredientName] = useState('');
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
  const comboboxRefs = useRef({});
  const amountRefs = useRef({});
  const [pendingFocusLineId, setPendingFocusLineId] = useState(null);
  const backToDashboardRef = useRef(null);

  // Each step renders as its own page: jump back to the top when it changes.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  // The "saved!" note only makes sense while you're on the ingredients step.
  useEffect(() => {
    if (step !== 'ingredients') setLastSavedIngredientName('');
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    if (!recipeId) {
      setLoadedRecipe(null);
      setRecipeLoadError('');
      // Leaving edit mode has to clear the form too, not just the loaded
      // recipe. "Exit edit" dropped recipe_id from the URL but left the
      // recipe's name and ingredient rows sitting in state, so it looked like
      // the button did nothing — and worse, the builder was now in create mode
      // holding a prefilled copy, so saving would have spawned a duplicate.
      // Done here rather than in the button so every exit path is covered:
      // browser back, and hand-editing the URL.
      setLines([newLine()]);
      setMealName('');
      setMealSaveError('');
      setMealSaved(false);
      setExpandedLines(new Set());
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

  /** From the build step's combobox: jump back to step 1 with the name prefilled. */
  function requestCreateIngredient(prefillName) {
    if (prefillName) {
      setLabelDraft(d => ({ ...d, name: prefillName }));
      setLabelSaveError('');
    }
    setLastSavedIngredientName('');
    goToStep('ingredients');
  }

  useEffect(() => {
    void reloadLabels();
  }, [reloadLabels]);

  const ingById = useMemo(() => Object.fromEntries(savedLabels.map(x => [String(x.id), x])), [savedLabels]);

  // If editing a label-built recipe, prefill from ingredients first, then
  // fall back to legacy meal_builder_meta.lines.
  useEffect(() => {
    if (mode !== 'labels') return;
    if (!loadedRecipe || !recipeId) return;
    const meta = loadedRecipe.meal_builder_meta;
    let nextLines = [];
    if (Array.isArray(loadedRecipe.ingredients)) {
      nextLines = loadedRecipe.ingredients
        .filter(x => x && (x.kind === 'ingredient' || x.label_ingredient_id != null || x.kind === 'slot'))
        .map(x => {
          const lid = x.label_ingredient_id
            ?? (Array.isArray(x.option_label_ingredient_ids) ? x.option_label_ingredient_ids[0] : null);
          if (lid == null) return null;
          return {
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
            labelIngredientId: String(lid),
            amount: x.amount != null ? String(x.amount) : '',
            unit: x.unit || 'g',
          };
        })
        .filter(Boolean);
    }
    if (nextLines.length === 0 && meta && typeof meta === 'object' && Array.isArray(meta.lines)) {
      nextLines = meta.lines
        .filter(x => x && x.label_ingredient_id != null)
        .map(x => ({
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
          labelIngredientId: String(x.label_ingredient_id),
          amount: x.amount != null ? String(x.amount) : '',
          unit: x.unit || 'g',
        }));
    }
    if (nextLines.length) setLines(nextLines);
    setMealName(loadedRecipe.name || '');
  }, [mode, loadedRecipe, recipeId]);

  useEffect(() => {
    if (!pendingFocusLineId) return;
    const el = comboboxRefs.current[pendingFocusLineId];
    if (el?.focus) {
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
    setLastSavedIngredientName('');
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
      setLabelScanFeedback(null);
      setLabelScanFieldStatus(null);
      setLastSavedIngredientName(name);
      await reloadLabels();
    } catch (err) {
      setLabelSaveError(err.message);
    }
  }

  function updateLine(id, patch) {
    setLines(prev =>
      prev.map(l => (l.id === id ? { ...l, ...patch } : l))
    );
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
      comboboxRefs.current[nextLine.id]?.focus();
    } else {
      const newL = newLine();
      setLines(prev => [...prev, newL]);
      setPendingFocusLineId(newL.id);
    }
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
      ingRows.push({
        ing,
        m,
        amount: line.amount,
        unit: line.unit,
      });
    }
    if (ingRows.length === 0) {
      setMealSaveError('Add at least one ingredient with a valid amount.');
      return;
    }
    const t = sumMacroObjects(ingRows.map(x => x.m));
    const ingredients = ingRows.map(x => ({
      kind: 'ingredient',
      name: x.ing.name,
      amount: String(x.amount),
      unit: x.ing.tracking_type === 'unit' ? (x.ing.unit_name || '') : (x.unit === 'oz' ? 'oz' : 'g'),
      label_ingredient_id: x.ing.id,
    }));
    const meal_builder_meta = { source: 'meal_builder' };
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
      const usedIds = [...new Set(ingRows.map(x => x.ing.id))];
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

  const wizardSteps = [
    { key: 'build', label: 'Build meal' },
    { key: 'save', label: recipeId ? 'Save changes' : 'Review & save' },
  ];

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Meal Builder</h1>
        <p className="page-subtitle" style={{ marginBottom: 14, fontSize: 15 }}>
          Build meals from your saved ingredients.
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
          Build from ingredients
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
          Known macros
        </button>
        {recipeId && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate(returnTo)}
            title="Stop editing and go back"
          >
            Exit edit
          </button>
        )}
      </Reveal>

      {recipeLoadError && <p className="error">{recipeLoadError}</p>}

      {mode === 'manual' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">
            {recipeId ? 'Edit recipe (known macros)' : 'New recipe — known macros'}
          </h3>
          {!recipeId && (
            <p style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--color-text-muted)' }}>
              Only a rough idea? Use the{' '}
              <Link to="/ai-logger" style={{ color: 'var(--color-link)' }}>✨ AI logger</Link>.
            </p>
          )}
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
            {step === 'ingredients' ? (
              <div className="wizard-detour-crumb">
                <button type="button" className="wizard-detour-back" onClick={() => goToStep('build')}>
                  ← Back to your meal
                </button>
                <span className="wizard-detour-label">Add ingredient</span>
              </div>
            ) : (
              <WizardStepper steps={wizardSteps} current={step} onSelect={goToStep} />
            )}
          </Reveal>

          {/* key={step} remounts the Reveal so each step animates in like a new page */}
          <Reveal key={step}>
            {step === 'ingredients' && (
              <StepIngredients
                savedLabels={savedLabels}
                labelDraft={labelDraft}
                setLabelDraft={setLabelDraft}
                ocrBusy={ocrBusy}
                onPickLabelPhoto={onPickLabelPhoto}
                onRunOcr={() => void runOcr()}
                onOpenCrop={() => setLabelCropOpen(true)}
                labelScanFeedback={labelScanFeedback}
                labelScanFieldStatus={labelScanFieldStatus}
                clearLabelScanHints={clearLabelScanHints}
                onSaveIngredient={saveLabelIngredient}
                onClearForm={() => {
                  setLabelDraft(emptyLabelDraft());
                  setLabelScanFeedback(null);
                  setLabelScanFieldStatus(null);
                }}
                labelSaveError={labelSaveError}
                lastSavedIngredientName={lastSavedIngredientName}
                onDone={() => goToStep('build')}
              />
            )}

            {step === 'build' && (
              <StepBuild
                savedLabels={savedLabels}
                ingById={ingById}
                lines={lines}
                setLines={setLines}
                lineMacros={lineMacros}
                totals={totals}
                updateLine={updateLine}
                handleIngredientSelect={handleIngredientSelect}
                handleAmountKeyDown={handleAmountKeyDown}
                comboboxRefs={comboboxRefs}
                amountRefs={amountRefs}
                onRequestCreate={requestCreateIngredient}
                onAddIngredient={() => goToStep('ingredients')}
                onContinue={() => goToStep('save')}
              />
            )}

            {step === 'save' && (
              <StepReview
                recipeId={recipeId}
                mealName={mealName}
                setMealName={setMealName}
                lines={lines}
                lineMacros={lineMacros}
                ingById={ingById}
                totals={totals}
                mealSaveError={mealSaveError}
                mealSaved={mealSaved}
                mealLoggedOnce={mealLoggedOnce}
                loggingOnce={loggingOnce}
                onSaveMeal={saveMeal}
                onLogOnce={logOnceMeal}
                onBack={() => goToStep('build')}
                onBackToDashboard={() => navigate('/', { state: { scrollToTop: true } })}
                backToDashboardRef={backToDashboardRef}
              />
            )}
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
