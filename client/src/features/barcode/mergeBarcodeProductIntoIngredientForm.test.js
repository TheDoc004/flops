import { describe, it, expect } from 'vitest';
import { mergeBarcodeProductIntoIngredientForm } from './mergeBarcodeProductIntoIngredientForm';

const blankForm = () => ({
  name: '',
  base_label: '',
  brand_name: '',
  serving_amount: '',
  serving_unit: 'g',
  serving_unit_custom: '',
  gram_equivalent: '',
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  fiber_g: '',
});

const product = (over = {}) => ({
  found: true,
  barcode: '3017620422003',
  name: 'Nutella',
  brand_name: 'Ferrero',
  basis: 'serving',
  serving_amount: 15,
  serving_unit: 'g',
  serving_size_text: '15 g',
  macros: { calories: 80.9, protein_g: 0.95, carbs_g: 8.63, fat_g: 4.64, fiber_g: 0.1 },
  ...over,
});

describe('mergeBarcodeProductIntoIngredientForm', () => {
  it('fills a blank form from a per-serving product', () => {
    const { next, fieldStatus } = mergeBarcodeProductIntoIngredientForm(blankForm(), product());
    expect(next.name).toBe('Nutella');
    expect(next.brand_name).toBe('Ferrero');
    expect(next.serving_amount).toBe('15');
    expect(next.serving_unit).toBe('g');
    expect(next.calories).toBe('80.9');
    expect(next.fat_g).toBe('4.64');
    expect(fieldStatus).toEqual({}); // nothing to double-check
  });

  it('never overwrites a name or brand the user already typed', () => {
    const prev = { ...blankForm(), name: 'My hazelnut spread', brand_name: 'Store brand' };
    const { next } = mergeBarcodeProductIntoIngredientForm(prev, product());
    expect(next.name).toBe('My hazelnut spread');
    expect(next.brand_name).toBe('Store brand');
    expect(next.calories).toBe('80.9'); // macros still fill in
  });

  it('flags derived macros as uncertain and explains the calculation', () => {
    const { fieldStatus, scanFeedback } = mergeBarcodeProductIntoIngredientForm(
      blankForm(),
      product({ basis: 'serving_derived', serving_amount: 40, serving_size_text: '40 g' })
    );
    expect(fieldStatus.calories).toBe('uncertain');
    expect(fieldStatus.serving_amount).toBe('uncertain');
    expect(scanFeedback.join(' ')).toMatch(/calculated for a 40 g serving/);
  });

  it('explains a 100 g fallback so the amount gets checked', () => {
    const { next, scanFeedback, fieldStatus } = mergeBarcodeProductIntoIngredientForm(
      blankForm(),
      product({ basis: '100g', serving_amount: 100, serving_size_text: '' })
    );
    expect(next.serving_amount).toBe('100');
    expect(fieldStatus.serving_amount).toBe('uncertain');
    expect(scanFeedback.join(' ')).toMatch(/per 100 g/);
  });

  it('marks absent macros as missing but stays quiet about fiber', () => {
    const { fieldStatus, scanFeedback } = mergeBarcodeProductIntoIngredientForm(
      blankForm(),
      product({ macros: { calories: 120, protein_g: null, carbs_g: 20, fat_g: null, fiber_g: null } })
    );
    expect(fieldStatus.protein_g).toBe('missing');
    expect(fieldStatus.fat_g).toBe('missing');
    expect(fieldStatus.fiber_g).toBeUndefined();
    expect(scanFeedback.join(' ')).toMatch(/Not listed for this product: protein, fat/);
  });

  it('points elsewhere when the product has no nutrition data at all', () => {
    const { next, scanFeedback, countFilled } = mergeBarcodeProductIntoIngredientForm(
      blankForm(),
      product({
        basis: 'none',
        serving_amount: null,
        macros: { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
      })
    );
    expect(countFilled).toBe(0);
    expect(next.name).toBe('Nutella'); // the name is still worth keeping
    expect(scanFeedback.join(' ')).toMatch(/no nutrition data/i);
    // No point telling someone to double-check numbers that were never filled.
    expect(scanFeedback.join(' ')).not.toMatch(/crowd-sourced/);
  });

  it('warns that the data is crowd-sourced whenever macros were filled', () => {
    const { scanFeedback } = mergeBarcodeProductIntoIngredientForm(blankForm(), product());
    expect(scanFeedback.join(' ')).toMatch(/crowd-sourced/);
  });

  it('carries a millilitre serving unit through', () => {
    const { next } = mergeBarcodeProductIntoIngredientForm(
      blankForm(),
      product({ serving_amount: 240, serving_unit: 'ml' })
    );
    expect(next.serving_unit).toBe('ml');
    expect(next.serving_amount).toBe('240');
  });
});
