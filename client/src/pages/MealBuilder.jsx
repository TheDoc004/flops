import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import RecipeForm from '../components/RecipeForm';
import IngredientCombobox from '../components/IngredientCombobox';
import IngredientCreateModal from '../components/IngredientCreateModal';
import LabelCropModal from '../components/LabelCropModal';
import { createRecipe, fetchRecipe, updateRecipe } from '../api/recipes';
import { createLabelIngredient, deleteLabelIngredient, fetchLabelIngredients, markLabelIngredientsUsed } from '../api/labelIngredients';
import { extractTextFromLabelImage } from '../utils/labelOcr';
import { parseNutritionFactsText } from '../utils/labelParse';
import { mergeNutritionParseIntoIngredientForm, scanFieldClass } from '../utils/mergeNutritionParseIntoIngredientForm';
import { macrosForLabelServingAmount, sumMacroObjects } from '../utils/labelMacro';

function emptyLabelDraft() {
  return {
    name: '',
    brand_name: '',
    serving_size_text: '',
    grams_per_serving: '',
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
  const [saveKind, setSaveKind] = useState('permanent');
  const [limitedUses, setLimitedUses] = useState(5);
  const [mealSaveError, setMealSaveError] = useState('');
  const [mealSaved, setMealSaved] = useState(false);
  const [ingredientCreateLineId, setIngredientCreateLineId] = useState(null);
  const [ingredientCreatePrefill, setIngredientCreatePrefill] = useState('');

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

  function openIngredientCreateForLine(lineId, prefillName) {
    setIngredientCreateLineId(lineId);
    setIngredientCreatePrefill(prefillName || '');
  }

  async function handleInlineIngredientSaved(created) {
    const lineId = ingredientCreateLineId;
    setIngredientCreateLineId(null);
    setIngredientCreatePrefill('');
    if (lineId && created?.id != null) {
      updateLine(lineId, { labelIngredientId: String(created.id) });
      setSavedLabels(prev => {
        const id = String(created.id);
        if (prev.some(x => String(x.id) === id)) return prev;
        const row = { ...created, has_photo: created.has_photo ?? 0 };
        return [...prev, row].sort((a, b) =>
          String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
        );
      });
    }
    try {
      await reloadLabels();
    } catch {
      /* list sync optional; row already uses created id */
    }
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
    setSaveKind(loadedRecipe.recipe_kind === 'limited' ? 'limited' : 'permanent');
    if (loadedRecipe.recipe_kind === 'limited') {
      setLimitedUses(Number(loadedRecipe.max_uses) || 5);
    }
  }, [mode, loadedRecipe, recipeId]);

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
        serving_size_text: labelDraft.serving_size_text,
        grams_per_serving: labelDraft.grams_per_serving,
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
        serving_size_text: next.serving_size_text,
        grams_per_serving: next.grams_per_serving,
        calories: next.calories,
        protein_g: next.protein_g,
        carbs_g: next.carbs_g,
        fat_g: next.fat_g,
        fiber_g: next.fiber_g,
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
    const serving_size_text = labelDraft.serving_size_text.trim();
    if (!name || !serving_size_text) {
      setLabelSaveError('Name and serving size (label text) are required.');
      return;
    }
    const grams_per_serving =
      labelDraft.grams_per_serving === '' ? null : Number(labelDraft.grams_per_serving);
    if (grams_per_serving != null && (!Number.isFinite(grams_per_serving) || grams_per_serving <= 0)) {
      setLabelSaveError('Grams per serving must be a positive number or left empty.');
      return;
    }
    try {
      await createLabelIngredient({
        name,
        brand_name: brand_name || undefined,
        serving_size_text,
        grams_per_serving,
        calories: Number(labelDraft.calories),
        protein_g: Number(labelDraft.protein_g),
        carbs_g: Number(labelDraft.carbs_g),
        fat_g: Number(labelDraft.fat_g),
        fiber_g: labelDraft.fiber_g === '' ? undefined : Number(labelDraft.fiber_g),
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
        recipe_kind: saveKind,
      };
      if (saveKind === 'limited') {
        const n = Number(limitedUses);
        if (!Number.isInteger(n) || n < 1 || n > 999) {
          setMealSaveError('Uses must be an integer from 1 to 999.');
          return;
        }
        body.max_uses = n;
        body.remaining_uses = n;
      }
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

  return (
    <div>
      <h1 style={{
        margin: '0 0 8px', fontSize: 32, fontWeight: 400,
        color: '#1e1b4b', letterSpacing: '-0.02em', lineHeight: 1.1,
        fontFamily: "'DM Serif Display', Georgia, serif",
      }}>Meal Builder</h1>
      <p style={{ margin: '0 0 14px', color: '#6b7280', fontSize: 14 }}>
        Create and edit recipes here. Browse and log from the <Link to="/recipes" style={{ color: '#2563eb' }}>Recipe Library</Link>. Use the Common Ingredient Library to reuse and swap ingredients.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          type="button"
          className={mode === 'labels' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('mode', 'labels');
            setSearchParams(next);
          }}
        >
          Label meal builder
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
      </div>

      {recipeLoadError && <p className="error">{recipeLoadError}</p>}

      {mode === 'manual' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{
            marginTop: 0, fontSize: 20, fontWeight: 400,
            color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
          }}>
            {recipeId ? 'Edit recipe (manual)' : 'New recipe (manual)'}
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
            Use this for recipes you want to enter directly (no label ingredients needed).
          </p>
          {loadingRecipe && recipeId ? (
            <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>Loading…</p>
          ) : (
            <RecipeForm
              key={recipeId ? `edit-${recipeId}` : 'manual-new'}
              initial={recipeId && loadedRecipe ? { ...loadedRecipe, fiber_g: loadedRecipe.fiber_g ?? '' } : undefined}
              submitLabel={recipeId ? 'Save changes' : 'Create recipe'}
              onCancel={() => navigate('/recipes')}
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

      <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{
            marginTop: 0, fontSize: 20, fontWeight: 400,
            color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
          }}>1. Common Ingredient Library (scan or enter once)</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          <strong>Assisted scan:</strong> photos are preprocessed (contrast + black/white) and read locally with Tesseract.js.
          Optional <strong>crop</strong> helps on busy or colored labels. Any values we fill are hints — compare with the package
          before saving. Dashed borders mark fields we could not read; amber marks values like &lt;1g that need manual entry.
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
        <form onSubmit={saveLabelIngredient} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Product / ingredient name</label>
            <input value={labelDraft.name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, name: e.target.value })); }} placeholder="e.g. Greek yogurt" required />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Brand (optional)</label>
            <input value={labelDraft.brand_name} onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, brand_name: e.target.value })); }} placeholder="e.g. Fage, Chobani" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Serving size (as printed)</label>
            <input
              className={scanFieldClass(labelScanFieldStatus?.serving_size_text)}
              value={labelDraft.serving_size_text}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, serving_size_text: e.target.value })); }}
              placeholder='e.g. 2/3 cup (55g)'
              required
            />
          </div>
          <div>
            <label>Grams per serving (for scaling)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className={scanFieldClass(labelScanFieldStatus?.grams_per_serving)}
              value={labelDraft.grams_per_serving}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, grams_per_serving: e.target.value })); }}
              placeholder="e.g. 55"
            />
          </div>
          <div>
            <label>Calories per serving</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className={scanFieldClass(labelScanFieldStatus?.calories)}
              value={labelDraft.calories}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, calories: e.target.value })); }}
              required
            />
          </div>
          <div>
            <label>Fat (g) / serving</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className={scanFieldClass(labelScanFieldStatus?.fat_g)}
              value={labelDraft.fat_g}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fat_g: e.target.value })); }}
              required
            />
          </div>
          <div>
            <label>Carbs (g) / serving</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className={scanFieldClass(labelScanFieldStatus?.carbs_g)}
              value={labelDraft.carbs_g}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, carbs_g: e.target.value })); }}
              required
            />
          </div>
          <div>
            <label>Protein (g) / serving</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className={scanFieldClass(labelScanFieldStatus?.protein_g)}
              value={labelDraft.protein_g}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, protein_g: e.target.value })); }}
              required
            />
          </div>
          <div>
            <label>Fiber (g) / serving</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className={scanFieldClass(labelScanFieldStatus?.fiber_g)}
              value={labelDraft.fiber_g}
              onChange={e => { clearLabelScanHints(); setLabelDraft(d => ({ ...d, fiber_g: e.target.value })); }}
              placeholder="Optional"
            />
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

        {savedLabels.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '0 0 8px' }}>Common ingredients</h4>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {savedLabels.map(s => (
                <li key={s.id} style={{ marginBottom: 6 }}>
                  <strong>{s.name}</strong>
                  {s.brand_name ? <span style={{ color: '#6b7280' }}> ({s.brand_name})</span> : null}
                  <span style={{ color: '#6b7280' }}> — {s.serving_size_text}</span>
                  {s.grams_per_serving != null && <span style={{ color: '#6b7280' }}> · {s.grams_per_serving}g/serving</span>}
                  {s.has_photo ? <span style={{ color: '#9ca3af' }}> · photo</span> : null}
                  <button type="button" className="btn-danger" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }} onClick={() => void deleteLabelIngredient(s.id).then(reloadLabels)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{
          marginTop: 0, fontSize: 20, fontWeight: 400,
          color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
        }}>2. Build meal</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          For each row: set a role label (optional), search your Ingredient Library, or use <strong>+ Create new ingredient</strong> at the bottom of the search list to add one inline—it saves to your library and selects it here. Then enter amount (g or oz). Totals update below.
        </p>
        {lines.map((line, idx) => {
          const m = lineMacros[idx];
          const defNum = Number(line.labelIngredientId);
          return (
            <div key={line.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 2fr 100px 80px auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 12 }}>Role label</label>
                  <input
                    value={line.roleLabel}
                    onChange={e => updateLine(line.id, { roleLabel: e.target.value })}
                    placeholder="e.g. Yogurt"
                  />
                </div>
                <div>
                  <IngredientCombobox
                    label="Ingredient (default)"
                    items={savedLabels}
                    value={line.labelIngredientId}
                    onChange={(next) => updateLine(line.id, { labelIngredientId: next })}
                    placeholder="Search ingredients…"
                    allowCreate
                    onRequestCreate={q => openIngredientCreateForLine(line.id, q)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Amount</label>
                  <input type="number" min="0.01" step="0.01" value={line.amount} onChange={e => updateLine(line.id, { amount: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Unit</label>
                  {ingById[line.labelIngredientId]?.tracking_type === 'unit'
                    ? (
                      <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 14, color: '#374151', paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                <button type="button" className="btn-secondary" onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))} disabled={lines.length <= 1}>Remove</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Substitutes (optional)</label>
                <p style={{ margin: '4px 0 6px', fontSize: 12, color: '#9ca3af' }}>
                  Add library ingredients you might swap in at log time. Logging asks only when substitutes exist.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
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
                  <select
                    style={{ maxWidth: 260 }}
                    value=""
                    onChange={e => {
                      addSubstituteToLine(line.id, e.target.value);
                      e.target.value = '';
                    }}
                    disabled={!line.labelIngredientId}
                  >
                    <option value="">{line.labelIngredientId ? '+ Add substitute…' : 'Choose default ingredient first…'}</option>
                    {sortedLabels
                      .filter(li => {
                        if (!Number.isInteger(defNum) || defNum <= 0) return false;
                        if (li.id === defNum) return false;
                        if ((line.substitute_label_ingredient_ids || []).includes(li.id)) return false;
                        return true;
                      })
                      .map(li => (
                        <option key={li.id} value={li.id}>
                          {li.name}
                          {li.brand_name ? ` (${li.brand_name})` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {m && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                  This row: {Math.round(m.calories)} cal · P {m.protein_g.toFixed(1)}g · C {m.carbs_g.toFixed(1)}g · F {m.fat_g.toFixed(1)}g
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="btn-secondary" onClick={() => setLines(prev => [...prev, newLine()])}>+ Add ingredient row</button>

        <div style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <strong>Meal totals</strong>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            {Math.round(totals.calories)} cal · P {totals.protein_g.toFixed(1)}g · C {totals.carbs_g.toFixed(1)}g · F {totals.fat_g.toFixed(1)}g
            {totals.fiber_g > 0 && ` · Fiber ${totals.fiber_g.toFixed(1)}g`}
          </div>
        </div>
      </div>

      <form className="card" onSubmit={saveMeal}>
        <h3 style={{
          marginTop: 0, fontSize: 20, fontWeight: 400,
          color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
        }}>3. Save as recipe / template</h3>
        {recipeId && (
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#6b7280' }}>
            Editing recipe #{recipeId}. Saving will update the existing recipe.
          </p>
        )}
        <div style={{ marginBottom: 12 }}>
          <label>Meal name</label>
          <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="e.g. Meal prep bowl #1" required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Save as</label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 16, cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={saveKind === 'permanent'} onChange={() => setSaveKind('permanent')} />
            Permanent recipe
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={saveKind === 'limited'} onChange={() => setSaveKind('limited')} />
            Limited-use meal template
          </label>
        </div>
        {saveKind === 'limited' && (
          <div style={{ marginBottom: 12 }}>
            <label>Number of logs (uses)</label>
            <input type="number" min={1} max={999} step={1} value={limitedUses} onChange={e => setLimitedUses(Number(e.target.value))} style={{ maxWidth: 120 }} />
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>Each time you log this meal, remaining uses decrease. At 0 it is archived and hidden from quick picks.</p>
          </div>
        )}
        {mealSaveError && <p className="error">{mealSaveError}</p>}
        {mealSaved && (
          <p style={{ color: '#059669', fontSize: 14 }}>
            Saved. <Link to="/recipes" style={{ color: '#2563eb' }}>Open Recipe Library</Link>
          </p>
        )}
        <button type="submit" className="btn-primary">Save meal</button>
      </form>
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

      <IngredientCreateModal
        open={ingredientCreateLineId != null}
        initialName={ingredientCreatePrefill}
        onClose={() => {
          setIngredientCreateLineId(null);
          setIngredientCreatePrefill('');
        }}
        onSaved={handleInlineIngredientSaved}
      />
    </div>
  );
}
