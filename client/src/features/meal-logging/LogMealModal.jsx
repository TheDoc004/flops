import { useEffect, useMemo, useRef, useState } from 'react';
import { createRecipe, fetchRecipe, fetchRecipes } from '@shared/api/recipes';
import { fetchLabelIngredients } from '@shared/api/labelIngredients';
import { fetchPreppedBatches } from '@shared/api/preppedBatches';
import { suggestSubstitutes } from '@shared/api/ai';
import RecipeCombobox from '@shared/ui/RecipeCombobox';
import IngredientCombobox from '@features/meal-builder/IngredientCombobox';
import { canonicalUnit, loggableUnitsFor } from '@shared/utils/unitConvert';
import { pluralizeUnit } from '@shared/utils/servingBasis';
import {
  addMacroTotals,
  computeEntryMacros,
  macroGoalStatus,
  scaleMacroTotals,
  subtractMacroTotals,
} from '@shared/utils/macros';
import { formatMacroMass } from '@shared/utils/macroUnits';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import {
  adjacentReceiptLineId,
  buildGhostReceiptLine,
  buildReceiptLine,
  buildReceiptLineFromPreppedBatch,
  buildRecipeFromReceipt,
  buildUnequalMealPrepRecipes,
  changeLineUnit,
  commitAllSuggestedAmounts,
  commitLineSuggestedAmount,
  generateMealName,
  getSuggestedSubstitutes,
  lineAmountIsEmpty,
  loadLastReceiptAmounts,
  normalizeMealPrepFractions,
  receiptToApiIngredients,
  refreshPreppedBatchLine,
  refreshReceiptLine,
  retargetLineToIngredient,
  saveLastReceiptAmounts,
  seedReceiptFromRecipe,
  seedReceiptFromLoggedSelections,
  sumReceiptMacros,
} from './recipeReceipt';

/** Vaulted: tap-name AI/heuristic swap. Flip true to revive. */
const SHOW_MEAL_SUBSTITUTES = false;

/** Matches Ingredients.jsx — prep batches stay vaulted until that flag flips. */
const SHOW_PREPPED_BATCHES = false;

const DAY_PREVIEW_MACROS = [
  { key: 'calories', label: 'Cal', targetKey: 'calories', isCalories: true },
  { key: 'protein_g', label: 'P', targetKey: 'protein_g', isCalories: false },
  { key: 'carbs_g', label: 'C', targetKey: 'carbs_g', isCalories: false },
  { key: 'fat_g', label: 'F', targetKey: 'fat_g', isCalories: false },
];

function formatDayPreviewValue(n, isCalories, macroUnits) {
  if (isCalories) return Math.round(n).toLocaleString('en-US');
  return formatMacroMass(n, macroUnits);
}

function dayPreviewStatusText(status, isCalories, macroUnits) {
  if (status.kind === 'none') return 'No goal';
  if (status.kind === 'ok') return 'In range';
  if (status.kind === 'over') {
    return `${formatDayPreviewValue(status.delta, isCalories, macroUnits)} over`;
  }
  return `${formatDayPreviewValue(status.delta, isCalories, macroUnits)} to range`;
}

function equalPercents(n) {
  const count = Math.max(2, Math.min(50, Math.floor(Number(n)) || 2));
  const base = Math.floor((100 / count) * 10) / 10;
  const percents = Array.from({ length: count }, () => base);
  const drift = Math.round((100 - percents.reduce((a, b) => a + b, 0)) * 10) / 10;
  percents[percents.length - 1] = Math.round((percents[percents.length - 1] + drift) * 10) / 10;
  return percents;
}

function parseHHMMToTimeMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function lineDisplayName(line) {
  if (!line?.name) return 'Ingredient';
  return line.brand_name ? `${line.name} (${line.brand_name})` : line.name;
}

export default function LogMealModal({ onLog, onClose, initialEntry, title, submitLabel, dayTotals, targets }) {
  const ref = useRef(null);
  const recipeComboboxRef = useRef(null);
  const addComboboxRef = useRef(null);
  const amountRefs = useRef(new Map());
  const focusAmountIdRef = useRef(null);
  const { macroUnits } = useMacroUnits();
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState(initialEntry?.recipe_id ? String(initialEntry.recipe_id) : '');
  const [mealName, setMealName] = useState(() => {
    if (initialEntry?.recipe_id) return '';
    return initialEntry?.recipe_name ? String(initialEntry.recipe_name) : '';
  });
  const [addIngredientId, setAddIngredientId] = useState('');
  const [servings, setServings] = useState(
    initialEntry?.servings != null ? String(initialEntry.servings) : '1'
  );
  const [notes, setNotes] = useState(initialEntry?.notes ? String(initialEntry.notes) : '');
  const [timeHHMM, setTimeHHMM] = useState(() => {
    if (initialEntry?.time_min == null) return '';
    const t = Number(initialEntry.time_min);
    if (!Number.isFinite(t) || t < 0 || t > 1439) return '';
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    return `${h}:${m}`;
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false);
  const [saveAsMealPrep, setSaveAsMealPrep] = useState(false);
  const [prepServings, setPrepServings] = useState(4);
  const [prepAdvancedOpen, setPrepAdvancedOpen] = useState(false);
  const [prepPercents, setPrepPercents] = useState(() => equalPercents(4));
  const [recipeName, setRecipeName] = useState('');
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [savedRecipeName, setSavedRecipeName] = useState('');
  const [labelIngredients, setLabelIngredients] = useState([]);
  const [preppedBatches, setPreppedBatches] = useState([]);
  const [receipt, setReceipt] = useState([]);
  const [seededFromRecipeId, setSeededFromRecipeId] = useState(null);
  const [activeLineId, setActiveLineId] = useState(null);
  const [subLineId, setSubLineId] = useState(null);
  const [subSuggestions, setSubSuggestions] = useState([]);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState('');
  const [subSource, setSubSource] = useState('');
  const receiptSeededRef = useRef(false);

  const selectedRecipe = useMemo(
    () => recipes.find(r => String(r.id) === String(recipeId)) || null,
    [recipes, recipeId]
  );

  const labelById = useMemo(
    () => Object.fromEntries(labelIngredients.map(x => [String(x.id), x])),
    [labelIngredients]
  );

  const batchById = useMemo(
    () => Object.fromEntries(preppedBatches.map(x => [String(x.id), x])),
    [preppedBatches]
  );

  const searchIngredients = useMemo(() => {
    if (!SHOW_PREPPED_BATCHES) return labelIngredients;
    const batchItems = preppedBatches.map(b => ({
      id: `pb:${b.id}`,
      name: b.name,
      serving_size_text: `${Math.round(Number(b.remaining_weight_g) || 0)} g left`,
      is_prepped_batch: true,
      calories: b.remaining_calories,
    }));
    return [...batchItems, ...labelIngredients];
  }, [labelIngredients, preppedBatches]);

  const receiptTotals = useMemo(() => sumReceiptMacros(receipt), [receipt]);
  const generatedMealName = useMemo(() => generateMealName(receipt), [receipt]);

  const editBaseline = useMemo(
    () => (initialEntry ? computeEntryMacros(initialEntry) : null),
    [initialEntry]
  );

  /** empty | recipe | name — transformative top bar */
  const topMode = useMemo(() => {
    if (recipeId) return 'recipe';
    if (receipt.length > 0) return 'name';
    return 'empty';
  }, [recipeId, receipt.length]);

  const mealStarted = topMode !== 'empty';

  const showServingsField = useMemo(() => {
    if (selectedRecipe?.recipe_kind === 'limited') return true;
    if (initialEntry && Number(initialEntry.servings) !== 1 && Number(initialEntry.servings) > 0) {
      return true;
    }
    return false;
  }, [selectedRecipe, initialEntry]);

  function resolveLogServings() {
    if (selectedRecipe?.recipe_kind === 'limited') return Number(servings) || 1;
    if (initialEntry && Number(initialEntry.servings) !== 1 && Number(initialEntry.servings) > 0) {
      return Number(servings) || 1;
    }
    return 1;
  }

  function focusTopSearch() {
    requestAnimationFrame(() => recipeComboboxRef.current?.focus());
  }

  function focusAddBar() {
    requestAnimationFrame(() => addComboboxRef.current?.focus());
  }

  function focusAmount(lineId) {
    if (!lineId) return;
    focusAmountIdRef.current = lineId;
    setActiveLineId(lineId);
    requestAnimationFrame(() => {
      const el = amountRefs.current.get(lineId);
      el?.focus();
      el?.select?.();
    });
  }

  useEffect(() => {
    focusTopSearch();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLabelIngredients(await fetchLabelIngredients());
      } catch {
        setLabelIngredients([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!SHOW_PREPPED_BATCHES) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchPreppedBatches();
        if (!cancelled) setPreppedBatches(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setPreppedBatches([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchRecipes();
        if (initialEntry?.recipe_id && !list.some(r => String(r.id) === String(initialEntry.recipe_id))) {
          try {
            const r = await fetchRecipe(initialEntry.recipe_id);
            setRecipes([r, ...list]);
          } catch {
            setRecipes(list);
          }
        } else {
          setRecipes(list);
        }
      } catch {
        setError('Failed to load recipes');
      }
    })();
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (receiptSeededRef.current) return;
    if (labelIngredients.length === 0 && !initialEntry) return;

    if (initialEntry?.ingredients_json) {
      try {
        const rows = typeof initialEntry.ingredients_json === 'string'
          ? JSON.parse(initialEntry.ingredients_json)
          : initialEntry.ingredients_json;
        if (Array.isArray(rows) && rows.length) {
          const lines = [];
          for (const r of rows) {
            const lid = Number(r.label_ingredient_id);
            const ing = Number.isInteger(lid) && lid > 0 ? labelById[String(lid)] : null;
            if (ing) {
              const line = buildReceiptLine(ing, r.amount, r.unit || 'g', { source: r.source || 'library' });
              if (line) lines.push(line);
            } else if (r.name && r.calories != null) {
              lines.push({
                id: `legacy_${lines.length}`,
                label_ingredient_id: lid > 0 ? lid : null,
                name: r.name,
                amount: String(r.amount ?? ''),
                unit: r.unit || '',
                calories: r.calories,
                protein_g: r.protein_g,
                carbs_g: r.carbs_g,
                fat_g: r.fat_g,
                fiber_g: r.fiber_g,
                source: r.source || 'estimated',
              });
            }
          }
          if (lines.length) {
            setReceipt(lines);
            receiptSeededRef.current = true;
            if (initialEntry.recipe_id) setSeededFromRecipeId(String(initialEntry.recipe_id));
            return;
          }
        }
      } catch {
        /* fall through */
      }
    }

    if (initialEntry?.slot_selections_json && Object.keys(labelById).length > 0) {
      const lines = seedReceiptFromLoggedSelections(initialEntry.slot_selections_json, labelById);
      if (lines.length) {
        setReceipt(lines);
        receiptSeededRef.current = true;
        if (initialEntry.recipe_id) setSeededFromRecipeId(String(initialEntry.recipe_id));
        return;
      }
    }

    if (selectedRecipe && Object.keys(labelById).length > 0) {
      const remembered = initialEntry ? {} : loadLastReceiptAmounts(selectedRecipe.id);
      const lines = seedReceiptFromRecipe(selectedRecipe, labelById, remembered);
      setReceipt(lines);
      setSeededFromRecipeId(String(selectedRecipe.id));
      receiptSeededRef.current = true;
    }
  }, [selectedRecipe, labelById, labelIngredients.length, initialEntry]);

  function clearRecipeSeed() {
    setRecipeId('');
    setSeededFromRecipeId(null);
    setReceipt([]);
    setMealName('');
    setServings('1');
    setActiveLineId(null);
    setSubLineId(null);
    setSubSuggestions([]);
    focusTopSearch();
  }

  function applyRecipeSeed(recipe) {
    if (!recipe) {
      setReceipt([]);
      setSeededFromRecipeId(null);
      return;
    }
    const remembered = loadLastReceiptAmounts(recipe.id);
    const lines = seedReceiptFromRecipe(recipe, labelById, remembered);
    setReceipt(lines);
    setSeededFromRecipeId(String(recipe.id));
    setMealName('');
    setActiveLineId(null);
    setSubLineId(null);
    setSubSuggestions([]);
  }

  function handleAddIngredient(nextId) {
    const idStr = String(nextId);
    if (SHOW_PREPPED_BATCHES && idStr.startsWith('pb:')) {
      const batch = batchById[idStr.slice(3)];
      if (!batch) return;
      const suggested = '100';
      const preview = buildReceiptLineFromPreppedBatch(batch, suggested);
      if (!preview) {
        setError(`${batch.name} has no remaining weight.`);
        return;
      }
      const line = {
        ...preview,
        amount: '',
        suggested_amount: suggested,
      };
      setError('');
      setAddIngredientId('');
      setReceipt(prev => [...prev, line]);
      focusAmount(line.id);
      return;
    }

    const ing = labelById[idStr];
    if (!ing) return;
    const line = buildGhostReceiptLine(ing, { source: 'library' });
    if (!line) {
      const units = loggableUnitsFor(ing);
      setError(
        units.length === 0
          ? `${ing.name} needs a serving size before it can be logged. Edit it in the Ingredient Library.`
          : `${ing.name} has no amount saved for one serving. Edit it in the Ingredient Library.`
      );
      return;
    }
    setError('');
    setAddIngredientId('');
    setReceipt(prev => [...prev, line]);
    focusAmount(line.id);
  }

  /** Top search: recipes seed the meal; first ingredients start a custom meal. */
  function handleTopSearchPick(nextId, kind) {
    if (kind === 'ingredient') {
      setRecipeId('');
      setSeededFromRecipeId(null);
      handleAddIngredient(nextId);
      return;
    }
    setRecipeId(nextId);
    const recipe = recipes.find(r => String(r.id) === String(nextId));
    if (recipe?.recipe_kind === 'limited') {
      setServings(prev => (prev && Number(prev) > 0 ? prev : '1'));
    } else {
      setServings('1');
    }
    applyRecipeSeed(recipe || null);
    focusAddBar();
  }

  function handleBottomAddPick(nextId) {
    handleAddIngredient(nextId);
  }

  function updateLineUnit(id, nextUnit) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== id) return line;
        if (line.prepped_batch_id) return line;
        const ing = labelById[String(line.label_ingredient_id)];
        const patch = ing ? changeLineUnit(line, ing, nextUnit) : null;
        if (!patch) return line;
        const next = { ...line, ...patch };
        if (lineAmountIsEmpty(next) && next.suggested_amount) {
          const preview = refreshReceiptLine(
            { ...next, amount: next.suggested_amount },
            ing
          );
          return { ...preview, amount: '' };
        }
        return refreshReceiptLine(next, ing);
      })
    );
  }

  function updateLine(id, patch) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        if (line.prepped_batch_id) {
          const batch = batchById[String(line.prepped_batch_id)];
          if (lineAmountIsEmpty(next) && next.suggested_amount) {
            const preview = refreshPreppedBatchLine(
              { ...next, amount: next.suggested_amount },
              batch
            );
            return { ...preview, amount: '' };
          }
          return refreshPreppedBatchLine(next, batch);
        }
        const ing = labelById[String(next.label_ingredient_id)];
        if (lineAmountIsEmpty(next) && next.suggested_amount && ing) {
          const preview = refreshReceiptLine(
            { ...next, amount: next.suggested_amount },
            ing
          );
          return { ...preview, amount: '' };
        }
        if (ing) return refreshReceiptLine(next, ing);
        return next;
      })
    );
  }

  function removeLine(id) {
    setReceipt(prev => {
      const idx = prev.findIndex(l => l.id === id);
      const next = prev.filter(l => l.id !== id);
      const neighbor = next[Math.min(idx, next.length - 1)] || null;
      setActiveLineId(neighbor?.id ?? null);
      if (neighbor) {
        requestAnimationFrame(() => focusAmount(neighbor.id));
      } else if (recipeId) {
        focusAddBar();
      } else {
        focusTopSearch();
      }
      return next;
    });
    if (subLineId === id) {
      setSubLineId(null);
      setSubSuggestions([]);
    }
  }

  function removeActiveOrLast() {
    if (receipt.length === 0) return;
    const id = activeLineId && receipt.some(l => l.id === activeLineId)
      ? activeLineId
      : receipt[receipt.length - 1].id;
    removeLine(id);
  }

  function moveActiveRow(delta) {
    if (receipt.length === 0) return;
    const nextId = adjacentReceiptLineId(receipt, activeLineId, delta);
    if (nextId) focusAmount(nextId);
  }

  function resetToRecipeAmounts() {
    if (!selectedRecipe) return;
    const lines = seedReceiptFromRecipe(selectedRecipe, labelById, {});
    setReceipt(lines);
    setSeededFromRecipeId(String(selectedRecipe.id));
  }

  async function openSubstitutes(line) {
    if (!SHOW_MEAL_SUBSTITUTES) return;
    setSubLineId(line.id);
    setSubError('');
    setSubSuggestions([]);
    setSubBusy(true);
    const current = labelById[String(line.label_ingredient_id)];
    const library = labelIngredients.filter(x => Number(x.id) !== Number(line.label_ingredient_id));
    try {
      const res = await suggestSubstitutes({
        ingredient: current
          ? {
              name: current.name,
              brand_name: current.brand_name,
              base_label: current.base_label,
              tracking_type: current.tracking_type,
            }
          : { name: line.name },
        library: library.slice(0, 80).map(x => ({
          id: x.id,
          name: x.name,
          brand_name: x.brand_name,
          base_label: x.base_label,
          last_used_at: x.last_used_at,
        })),
        limit: 5,
      });
      const ids = Array.isArray(res?.suggestions)
        ? res.suggestions.map(s => Number(s.label_ingredient_id)).filter(n => Number.isInteger(n) && n > 0)
        : [];
      const byId = new Map(library.map(x => [Number(x.id), x]));
      const fromAi = ids.map(id => byId.get(id)).filter(Boolean);
      if (fromAi.length) {
        setSubSuggestions(fromAi);
        setSubSource('ai');
        setSubBusy(false);
        return;
      }
    } catch (e) {
      setSubError(e.message || 'AI substitutes unavailable. Showing similar foods from your library.');
    }
    setSubSuggestions(getSuggestedSubstitutes(current, library, { excludeId: line.label_ingredient_id, limit: 5 }));
    setSubSource('heuristic');
    setSubBusy(false);
  }

  function applySubstitute(lineId, ing) {
    setReceipt(prev =>
      prev.map(line => {
        if (line.id !== lineId) return line;
        const { amount, unit } = retargetLineToIngredient(line, ing);
        return refreshReceiptLine(
          { ...line, amount, unit, label_ingredient_id: Number(ing.id), source: 'library' },
          ing
        );
      })
    );
    setSubLineId(null);
    setSubSuggestions([]);
  }

  function openSavePanel({ mealPrep }) {
    setError('');
    setSavedRecipeName('');
    setSaveAsMealPrep(Boolean(mealPrep));
    setPrepAdvancedOpen(false);
    const n = 4;
    setPrepServings(n);
    setPrepPercents(equalPercents(n));
    if (!recipeName.trim()) {
      const hint = selectedRecipe?.name || receipt[0]?.name || '';
      setRecipeName(hint ? String(hint) : '');
    }
    setSaveRecipeOpen(true);
  }

  function closeSavePanel() {
    setSaveRecipeOpen(false);
    setSaveAsMealPrep(false);
    setPrepAdvancedOpen(false);
    setRecipeName('');
  }

  function setPrepServingCount(n) {
    const v = Math.floor(Number(n));
    if (!Number.isInteger(v) || v < 2 || v > 50) return;
    setPrepServings(v);
    setPrepPercents(equalPercents(v));
  }

  async function handleSaveRecipe() {
    if (savingRecipe) return;
    setError('');
    if (receipt.length === 0) {
      setError('Add at least one ingredient before saving.');
      return;
    }
    if (!String(recipeName ?? '').trim()) {
      setError('Give the recipe a name.');
      return;
    }

    setSavingRecipe(true);
    try {
      const committed = commitAllSuggestedAmounts(receipt, labelById);
      if (saveAsMealPrep && prepAdvancedOpen) {
        const fractions = normalizeMealPrepFractions(prepPercents);
        if (!fractions) {
          setError('Custom split needs at least two positive percentages.');
          setSavingRecipe(false);
          return;
        }
        const sumPct = prepPercents.reduce((a, b) => a + Number(b || 0), 0);
        if (Math.abs(sumPct - 100) > 0.6) {
          setError(`Custom split should add up to 100% (currently ${sumPct.toFixed(1)}%).`);
          setSavingRecipe(false);
          return;
        }
        const bodies = buildUnequalMealPrepRecipes(committed, recipeName, prepPercents);
        if (!bodies?.length) {
          setError('Could not build the meal-prep containers.');
          setSavingRecipe(false);
          return;
        }
        const createdList = [];
        for (const body of bodies) {
          createdList.push(await createRecipe(body));
        }
        setRecipes(prev => {
          const ids = new Set(createdList.map(c => Number(c.id)));
          return [...createdList, ...prev.filter(r => !ids.has(Number(r.id)))];
        });
        setSavedRecipeName(
          `${bodies[0].name.replace(/ \(\d+\/\d+\)$/, '')} — ${bodies.length} containers`
        );
      } else {
        const body = buildRecipeFromReceipt(
          committed,
          recipeName,
          saveAsMealPrep ? { mealPrepServings: prepServings } : undefined
        );
        if (!body) {
          setError(
            saveAsMealPrep
              ? 'Pick how many servings to split into (2–50).'
              : 'Could not save this meal as a recipe.'
          );
          setSavingRecipe(false);
          return;
        }
        const created = await createRecipe(body);
        setRecipes(prev => [created, ...prev.filter(r => Number(r.id) !== Number(created.id))]);
        setSavedRecipeName(
          saveAsMealPrep
            ? `${body.name} (${prepServings} servings)`
            : body.name
        );
      }
      closeSavePanel();
    } catch (err) {
      setError(err.message || 'Could not save the recipe.');
    } finally {
      setSavingRecipe(false);
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (submitting) return;
    setError('');

    const committed = commitAllSuggestedAmounts(receipt, labelById);
    setReceipt(committed);
    const apiIngredients = receiptToApiIngredients(committed);
    const time_min = parseHHMMToTimeMin(timeHHMM);
    const notesVal = notes.trim() || undefined;
    const logServings = resolveLogServings();

    try {
      setSubmitting(true);

      if (recipeId && seededFromRecipeId && String(recipeId) === String(seededFromRecipeId) && apiIngredients.length > 0) {
        if (committed.some(l => l.label_ingredient_id && l.calories == null)) {
          setSubmitting(false);
          return setError('One or more ingredients need grams per serving. Edit them in the Ingredient Library.');
        }
        const payload = {
          recipe_id: Number(recipeId),
          servings: logServings,
          notes: notesVal,
          time_min,
          ingredients: apiIngredients,
        };
        await onLog(payload);
        const amounts = {};
        for (const l of committed) {
          const n = Number(l.amount);
          if (l.label_ingredient_id && Number.isFinite(n) && n > 0) {
            amounts[String(l.label_ingredient_id)] = { amount: String(n), unit: l.unit };
          }
        }
        if (Object.keys(amounts).length) saveLastReceiptAmounts(Number(recipeId), amounts);
      } else if (recipeId && apiIngredients.length === 0) {
        await onLog({
          recipe_id: Number(recipeId),
          servings: logServings,
          notes: notesVal,
          time_min,
        });
      } else if (apiIngredients.length > 0) {
        if (committed.some(l => l.label_ingredient_id && l.calories == null)) {
          setSubmitting(false);
          return setError('One or more ingredients need grams per serving. Edit them in the Ingredient Library.');
        }
        const name = mealName.trim() || generateMealName(committed) || 'Custom meal';
        const totals = sumReceiptMacros(committed);
        await onLog({
          custom: {
            name,
            calories: Math.round((totals?.calories || 0) * 10) / 10,
            protein_g: Math.round((totals?.protein_g || 0) * 100) / 100,
            carbs_g: Math.round((totals?.carbs_g || 0) * 100) / 100,
            fat_g: Math.round((totals?.fat_g || 0) * 100) / 100,
            fiber_g: totals?.fiber_g > 0 ? Math.round(totals.fiber_g * 100) / 100 : undefined,
            servings: 1,
            notes: notesVal,
            time_min,
            ingredients: apiIngredients,
          },
        });
      } else {
        setSubmitting(false);
        return setError('Add at least one ingredient, or pick a recipe.');
      }

      ref.current?.close();
      onClose();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  function onAmountKeyDown(e, line) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (lineAmountIsEmpty(line) && line.suggested_amount) {
      const ing = labelById[String(line.label_ingredient_id)];
      if (line.prepped_batch_id) {
        const batch = batchById[String(line.prepped_batch_id)];
        const committed = commitLineSuggestedAmount(line, null);
        setReceipt(prev => prev.map(l => (
          l.id === line.id ? refreshPreppedBatchLine(committed, batch) : l
        )));
      } else {
        setReceipt(prev => prev.map(l => (
          l.id === line.id ? commitLineSuggestedAmount(l, ing) : l
        )));
      }
    }
    focusAddBar();
  }

  function onDialogKeyDown(e) {
    if (saveRecipeOpen || submitting) return;
    if (recipeComboboxRef.current?.isOpen?.()) return;
    if (addComboboxRef.current?.isOpen?.()) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit(e);
      return;
    }
    if (mod && e.key === 'Backspace') {
      e.preventDefault();
      removeActiveOrLast();
      return;
    }

    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (receipt.length === 0) return;
    if (e.target?.tagName === 'SELECT') return;
    e.preventDefault();
    moveActiveRow(e.key === 'ArrowDown' ? 1 : -1);
  }

  function close() {
    if (submitting) return;
    ref.current?.close();
    onClose();
  }

  const logServingsDisplay = resolveLogServings();

  const projectedDay = useMemo(() => {
    if (!dayTotals || !targets || !receiptTotals) return null;
    const mealLogged = scaleMacroTotals(receiptTotals, logServingsDisplay);
    const dayWithoutEdit = editBaseline
      ? subtractMacroTotals(dayTotals, editBaseline)
      : dayTotals;
    return addMacroTotals(dayWithoutEdit, mealLogged);
  }, [dayTotals, targets, receiptTotals, logServingsDisplay, editBaseline]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onKeyDown={onDialogKeyDown}
      style={{ width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{title || 'Log a Meal'}</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          {topMode === 'empty' && (
            <RecipeCombobox
              ref={recipeComboboxRef}
              label="Start with a recipe or ingredient"
              recipes={recipes}
              ingredients={searchIngredients}
              value=""
              valueKind="recipe"
              onChange={handleTopSearchPick}
              placeholder="Search recipes or ingredients…"
              refocusOnSelect={false}
            />
          )}
          {topMode === 'recipe' && (
            <div className="log-meal-recipe-chip">
              <div className="log-meal-recipe-chip__body">
                <span className="log-meal-recipe-chip__label">Recipe</span>
                <strong className="log-meal-recipe-chip__name">
                  {selectedRecipe?.name || 'Selected recipe'}
                </strong>
                <span className="log-meal-recipe-chip__hint">
                  Edit the list below; the saved recipe stays unchanged.
                </span>
              </div>
              <button
                type="button"
                className="slot-row__remove"
                aria-label="Clear recipe"
                title="Clear recipe"
                onClick={clearRecipeSeed}
              >
                ✕
              </button>
            </div>
          )}
          {topMode === 'name' && (
            <div>
              <label htmlFor="log-meal-name">Meal name</label>
              <input
                id="log-meal-name"
                type="text"
                value={mealName}
                onChange={e => setMealName(e.target.value)}
                placeholder={generatedMealName || 'Name this meal'}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        {showServingsField && (
          <div>
            <label>Servings</label>
            <input
              type="text"
              inputMode="decimal"
              value={servings}
              onChange={e => setServings(e.target.value)}
              required
            />
          </div>
        )}

        <div className="panel-in modal-subpanel" style={{ padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-secondary-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 28, marginBottom: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                What&apos;s in this meal
              </p>
              {mealStarted && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  ↑↓ move · ⌘⌫ remove · ⌘↵ log
                </p>
              )}
            </div>
            {selectedRecipe && receipt.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetToRecipeAmounts}
                style={{ minHeight: 0, padding: '5px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                Reset to recipe
              </button>
            )}
          </div>

          {receipt.length === 0 ? (
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {mealStarted
                ? 'Add foods with the row below.'
                : 'Search above to start, then add more below.'}
            </p>
          ) : (
            <div className="slot-list">
              <div className="slot-list__head" aria-hidden="true">
                <span>Ingredient</span>
                <span>Amount</span>
                <span>Unit</span>
                <span />
              </div>
              {receipt.map(line => {
                const lineIng = labelById[String(line.label_ingredient_id)];
                const lineUnit = canonicalUnit(line.unit);
                const options = lineIng ? loggableUnitsFor(lineIng) : [];
                const unitOptions = options.includes(lineUnit) ? options : [];
                const unitLabel = line.unit || line.unit_name || 'unit';
                const open = SHOW_MEAL_SUBSTITUTES && subLineId === line.id;
                const isActive = activeLineId === line.id;
                const ghost = lineAmountIsEmpty(line);
                return (
                  <div key={line.id} className="slot-list__line">
                    <div
                      className={`slot-row${isActive ? ' is-active' : ''}`}
                      onPointerDown={() => setActiveLineId(line.id)}
                    >
                      <div className="slot-row__name" title={lineDisplayName(line)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {SHOW_MEAL_SUBSTITUTES ? (
                            <button
                              type="button"
                              onClick={() => (open ? setSubLineId(null) : openSubstitutes(line))}
                              aria-expanded={open}
                              aria-label={`Find substitutes for ${line.name}`}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                margin: 0,
                                textAlign: 'left',
                                cursor: 'pointer',
                                color: 'var(--color-text-strong)',
                                font: 'inherit',
                                textDecoration: 'underline',
                                textDecorationStyle: 'dotted',
                              }}
                              title="Find substitutes from your library"
                            >
                              {line.name}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--color-text-strong)', font: 'inherit' }}>
                              {line.name}
                            </span>
                          )}
                        </div>
                        {line.calories != null && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                              marginTop: 2,
                              opacity: ghost ? 0.65 : 1,
                            }}
                          >
                            {Math.round(line.calories)} cal · P {Number(line.protein_g).toFixed(1)} · C{' '}
                            {Number(line.carbs_g).toFixed(1)} · F {Number(line.fat_g).toFixed(1)}
                            {ghost ? ' · suggested' : ''}
                          </div>
                        )}
                      </div>
                      <input
                        ref={el => {
                          if (el) amountRefs.current.set(line.id, el);
                          else amountRefs.current.delete(line.id);
                        }}
                        type="text"
                        inputMode="decimal"
                        aria-label={`Amount for ${line.name}`}
                        value={line.amount}
                        placeholder={line.suggested_amount ? String(line.suggested_amount) : undefined}
                        onChange={e => updateLine(line.id, { amount: e.target.value })}
                        onFocus={() => setActiveLineId(line.id)}
                        onKeyDown={e => onAmountKeyDown(e, line)}
                      />
                      {unitOptions.length > 1 ? (
                        <select
                          aria-label={`Unit for ${line.name}`}
                          value={lineUnit}
                          onChange={e => updateLineUnit(line.id, e.target.value)}
                          onFocus={() => setActiveLineId(line.id)}
                        >
                          {unitOptions.map(u => (
                            <option key={u} value={u}>
                              {pluralizeUnit(u, line.amount || line.suggested_amount)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="slot-row__unit-static">{unitLabel}</div>
                      )}
                      <button
                        type="button"
                        className="slot-row__remove"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => removeLine(line.id)}
                      >
                        ✕
                      </button>
                    </div>
                    {open && (
                      <div className="slot-list__subs">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <div style={{ fontWeight: 600 }}>
                            Substitutes from your library
                            {subSource === 'ai' ? ' (AI)' : subSource === 'heuristic' ? ' (similar)' : ''}
                          </div>
                          <button
                            type="button"
                            className="slot-row__remove"
                            aria-label="Close substitutes"
                            onClick={() => { setSubLineId(null); setSubSuggestions([]); }}
                          >
                            ✕
                          </button>
                        </div>
                        {subBusy && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Looking…</p>}
                        {subError && !subBusy && (
                          <p style={{ margin: '0 0 6px', color: '#92400e' }}>{subError}</p>
                        )}
                        {!subBusy && subSuggestions.length === 0 && (
                          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No close matches found.</p>
                        )}
                        {!subBusy && subSuggestions.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {subSuggestions.map(ing => (
                              <button
                                key={ing.id}
                                type="button"
                                className="btn-secondary"
                                onClick={() => applySubstitute(line.id, ing)}
                                style={{
                                  justifyContent: 'flex-start',
                                  textAlign: 'left',
                                  minHeight: 0,
                                  padding: '6px 10px',
                                  fontSize: 12,
                                }}
                              >
                                {ing.name}
                                {ing.brand_name ? ` (${ing.brand_name})` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {mealStarted && (
            <div className="slot-row slot-row--add" aria-label="Add another ingredient">
              <div className="slot-row__name slot-row--add__search">
                <IngredientCombobox
                  ref={addComboboxRef}
                  items={searchIngredients}
                  value={addIngredientId}
                  onChange={handleBottomAddPick}
                  onSelect={() => { /* parent focuses amount */ }}
                  label=""
                  placeholder="Add another food…"
                />
              </div>
              <div className="slot-row--add__ghost" aria-hidden="true">40</div>
              <div className="slot-row--add__ghost slot-row--add__ghost-unit" aria-hidden="true">g</div>
              <div className="slot-row--add__spacer" aria-hidden="true" />
            </div>
          )}

          {receiptTotals && (
            <div
              className="modal-highlight-panel"
              style={{
                marginTop: 8,
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-primary-subtle)',
                fontSize: 12,
                color: 'var(--color-primary-ink)',
              }}
            >
              <strong>Meal total:</strong>{' '}
              {Math.round(receiptTotals.calories)} cal · P {receiptTotals.protein_g.toFixed(1)}g · C{' '}
              {receiptTotals.carbs_g.toFixed(1)}g · F {receiptTotals.fat_g.toFixed(1)}g
              {receiptTotals.fiber_g > 0 && ` · Fiber ${receiptTotals.fiber_g.toFixed(1)}g`}
              {showServingsField && logServingsDisplay !== 1 && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {'. This log '}({logServingsDisplay} servings):{' '}
                  <strong style={{ color: 'var(--color-text-strong)' }}>
                    {Math.round(receiptTotals.calories * logServingsDisplay)} cal
                  </strong>
                </span>
              )}
              {projectedDay && (
                <div
                  className="log-meal-day-preview"
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid color-mix(in srgb, var(--color-primary) 22%, var(--color-border))',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>After this meal</div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr',
                      gap: 3,
                    }}
                  >
                    {DAY_PREVIEW_MACROS.map(({ key, label, targetKey, isCalories }) => {
                      const value = projectedDay[key];
                      const status = macroGoalStatus(value, targets?.[targetKey]);
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <span>
                            <span style={{ fontWeight: 600, minWidth: 28, display: 'inline-block' }}>{label}</span>
                            {' '}
                            {formatDayPreviewValue(value, isCalories, macroUnits)}
                          </span>
                          <span className={`macro-status is-${status.mod}`} style={{ fontSize: 11 }}>
                            {dayPreviewStatusText(status, isCalories, macroUnits)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <label>Time (optional)</label>
            <input type="time" value={timeHHMM} onChange={e => setTimeHHMM(e.target.value)} />
          </div>
          <div>
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. post-workout" />
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {savedRecipeName && !saveRecipeOpen && (
          <p
            aria-live="polite"
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-success)', fontWeight: 600 }}
          >
            Saved “{savedRecipeName}” to your recipes.
          </p>
        )}

        {saveRecipeOpen && (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              background: 'var(--color-surface-subtle, var(--color-primary-subtle))',
            }}
          >
            <label htmlFor="log-recipe-name" style={{ fontSize: 15, fontWeight: 600 }}>
              {saveAsMealPrep ? 'Name this meal prep' : 'Name this recipe'}
            </label>
            <input
              id="log-recipe-name"
              value={recipeName}
              onChange={e => setRecipeName(e.target.value)}
              placeholder={saveAsMealPrep ? 'e.g. Chicken rice prep' : 'e.g. Morning oats v2'}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void handleSaveRecipe(); }
              }}
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
                checked={saveAsMealPrep}
                onChange={e => {
                  const on = e.target.checked;
                  setSaveAsMealPrep(on);
                  if (on) {
                    setPrepServingCount(prepServings >= 2 ? prepServings : 4);
                    setPrepAdvancedOpen(false);
                  }
                }}
              />
              This is a meal prep
            </label>

            {saveAsMealPrep && (
              <div className="prep-panel" style={{ marginTop: 10 }}>
                <h4 className="prep-panel__title">Split the batch</h4>
                <p style={{ margin: '6px 0 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {prepAdvancedOpen
                    ? 'Custom % per container — each container becomes its own 1-serving prep.'
                    : `Equal split into ${prepServings} — each logged serving counts down until the batch is gone.`}
                </p>

                {!prepAdvancedOpen && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(prepServings != null && ![2, 3, 4, 5, 6].includes(prepServings)
                        ? [2, 3, 4, 5, 6, prepServings].sort((a, b) => a - b)
                        : [2, 3, 4, 5, 6]
                      ).map(nS => {
                        const cal = receiptTotals ? Math.round(receiptTotals.calories / nS) : null;
                        const p = receiptTotals ? (receiptTotals.protein_g / nS).toFixed(1) : null;
                        const c = receiptTotals ? (receiptTotals.carbs_g / nS).toFixed(1) : null;
                        const f = receiptTotals ? (receiptTotals.fat_g / nS).toFixed(1) : null;
                        return (
                          <button
                            key={nS}
                            type="button"
                            className={prepServings === nS ? 'prep-split is-selected' : 'prep-split'}
                            onClick={() => setPrepServingCount(nS)}
                          >
                            <span className="prep-split__count">÷ {nS} servings</span>
                            {cal != null && (
                              <span className="prep-split__macros">
                                {cal} cal · P {p}g · C {c}g · F {f}g
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                      <label htmlFor="log-prep-servings" style={{ margin: 0, fontSize: 13 }}>Custom count:</label>
                      <input
                        id="log-prep-servings"
                        type="number"
                        min="2"
                        max="50"
                        step="1"
                        value={prepServings}
                        onChange={e => setPrepServingCount(e.target.value)}
                        style={{ width: 90 }}
                      />
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (!prepAdvancedOpen) {
                      setPrepPercents(equalPercents(prepServings));
                    }
                    setPrepAdvancedOpen(o => !o);
                  }}
                  style={{ marginTop: 12, minHeight: 40, width: '100%', fontSize: 13 }}
                >
                  {prepAdvancedOpen ? 'Use equal split instead' : 'Advanced: custom % per container'}
                </button>

                {prepAdvancedOpen && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <label htmlFor="log-prep-containers" style={{ margin: 0, fontSize: 13 }}>Containers:</label>
                      <input
                        id="log-prep-containers"
                        type="number"
                        min="2"
                        max="12"
                        step="1"
                        value={prepPercents.length}
                        onChange={e => {
                          const v = Math.floor(Number(e.target.value));
                          if (!Number.isInteger(v) || v < 2 || v > 12) return;
                          setPrepServings(v);
                          setPrepPercents(equalPercents(v));
                        }}
                        style={{ width: 90 }}
                      />
                    </div>
                    {prepPercents.map((pct, i) => {
                      const frac = Number(pct) / 100;
                      const cal = receiptTotals && Number.isFinite(frac)
                        ? Math.round(receiptTotals.calories * frac)
                        : null;
                      return (
                        <div
                          key={`pct-${i}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                        >
                          <label htmlFor={`log-prep-pct-${i}`} style={{ margin: 0, fontSize: 13, minWidth: 88 }}>
                            Container {i + 1}
                          </label>
                          <input
                            id={`log-prep-pct-${i}`}
                            type="number"
                            min="0.1"
                            max="99.9"
                            step="0.1"
                            value={pct}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setPrepPercents(prev => prev.map((x, j) => (j === i ? v : x)));
                            }}
                            style={{ width: 88 }}
                          />
                          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>%</span>
                          {cal != null && (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                              ~{cal} cal
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Total:{' '}
                      {prepPercents.reduce((a, b) => a + Number(b || 0), 0).toFixed(1)}%
                      {' '}(should be 100%)
                    </p>
                  </div>
                )}
              </div>
            )}

            <p style={{ margin: '10px 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {saveAsMealPrep
                ? prepAdvancedOpen
                  ? `Saves ${prepPercents.length} limited prep recipes (1 use each) from the ${receipt.length} ingredient${receipt.length === 1 ? '' : 's'} above. Does not log the meal.`
                  : `Saves a limited-use template with ${prepServings} uses from the ${receipt.length} ingredient${receipt.length === 1 ? '' : 's'} above. Does not log the meal.`
                : `Saves the ${receipt.length} ingredient${receipt.length === 1 ? '' : 's'} above as a recipe you can log again and edit later. This does not log the meal.`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={savingRecipe ? 'btn-primary btn-loading' : 'btn-primary'}
                disabled={savingRecipe}
                onClick={() => void handleSaveRecipe()}
              >
                {savingRecipe
                  ? (<><span className="btn-spinner" aria-hidden="true" />Saving…</>)
                  : saveAsMealPrep
                    ? 'Save meal prep'
                    : 'Save recipe'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={savingRecipe}
                onClick={closeSavePanel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="submit"
            className={submitting ? 'btn-primary btn-loading' : 'btn-primary'}
            disabled={submitting}
            style={{ width: '100%', minHeight: 56, fontSize: '1.1rem', fontWeight: 700, borderRadius: 12 }}
          >
            {submitting ? (<><span className="btn-spinner" aria-hidden="true" />Logging…</>) : (submitLabel || 'Log Meal')}
          </button>
          {!saveRecipeOpen && receipt.length > 0 && (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={submitting}
                onClick={() => openSavePanel({ mealPrep: false })}
                style={{ width: '100%', minHeight: 44, fontWeight: 600, borderRadius: 12 }}
              >
                Save as Recipe
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={submitting}
                onClick={() => openSavePanel({ mealPrep: true })}
                style={{ width: '100%', minHeight: 44, fontWeight: 600, borderRadius: 12 }}
              >
                Save as Meal Prep
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
