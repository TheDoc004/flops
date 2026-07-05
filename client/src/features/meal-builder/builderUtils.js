import { emptyServing } from '@shared/utils/servingBasis';

export function emptyLabelDraft() {
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

export function newLine() {
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

export function newSlotId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}

export function macroSummaryText(macros, { fiber = false } = {}) {
  const base = `${Math.round(macros.calories)} cal · P ${macros.protein_g.toFixed(1)}g · C ${macros.carbs_g.toFixed(1)}g · F ${macros.fat_g.toFixed(1)}g`;
  return fiber && macros.fiber_g > 0
    ? `${base} · Fiber ${macros.fiber_g.toFixed(1)}g`
    : base;
}

export function getSuggestedSubstitutes(defaultIng, candidates) {
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
