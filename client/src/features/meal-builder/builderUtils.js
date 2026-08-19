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
    labelIngredientId: '',
    amount: '',
    unit: 'g',
  };
}

export function macroSummaryText(macros, { fiber = false } = {}) {
  const base = `${Math.round(macros.calories)} cal · P ${macros.protein_g.toFixed(1)}g · C ${macros.carbs_g.toFixed(1)}g · F ${macros.fat_g.toFixed(1)}g`;
  return fiber && macros.fiber_g > 0
    ? `${base} · Fiber ${macros.fiber_g.toFixed(1)}g`
    : base;
}
