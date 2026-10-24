import { describe, it, expect } from 'vitest';
import {
  listRecipeIngredientLines,
  seedReceiptFromRecipe,
  seedReceiptFromIngredientsJson,
  seedReceiptFromLoggedSelections,
  sumReceiptMacros,
  receiptToApiIngredients,
  buildReceiptLine,
  buildGhostReceiptLine,
  commitLineSuggestedAmount,
  commitAllSuggestedAmounts,
  adjacentReceiptLineId,
  generateMealName,
  lineAmountIsEmpty,
  persistAmountUnit,
  changeLineUnit,
  retargetLineToIngredient,
  buildRecipeFromReceipt,
  buildUnequalMealPrepRecipes,
  buildRecipeFromLogEntry,
  augmentMealPrepRecipe,
  isEqualSplitMealPrep,
  mealPrepContainerCount,
  normalizeMealPrepFractions,
} from './recipeReceipt';

const oats = {
  id: 1, name: 'Oats', tracking_type: 'weight', grams_per_serving: 40,
  calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3, fiber_g: 4,
};
const egg = {
  id: 3, name: 'Egg', tracking_type: 'unit', serving_quantity: 1, unit_name: 'egg',
  calories: 72, protein_g: 6, carbs_g: 0.4, fat_g: 5,
};
const labelById = { 1: oats, 3: egg };

describe('persistAmountUnit', () => {
  it('normalizes mass units and keeps count units', () => {
    expect(persistAmountUnit('ounces')).toBe('oz');
    expect(persistAmountUnit('g')).toBe('g');
    expect(persistAmountUnit('egg')).toBe('egg');
  });
});

describe('listRecipeIngredientLines', () => {
  it('reads kind:ingredient lines and migrates legacy slots to the default id', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '40', unit: 'g', label_ingredient_id: 1 },
        { kind: 'slot', slot_id: 's1', label: 'Eggs', amount: '2', unit: 'egg', option_label_ingredient_ids: [3, 9] },
      ],
    };
    expect(listRecipeIngredientLines(recipe)).toEqual([
      { label_ingredient_id: 1, name: 'Oats', amount: '40', unit: 'g' },
      { label_ingredient_id: 3, name: 'Eggs', amount: '2', unit: 'egg' },
    ]);
  });
});

describe('seedReceiptFromRecipe', () => {
  it('builds live receipt lines from the recipe template', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '80', unit: 'g', label_ingredient_id: 1 },
      ],
    };
    const lines = seedReceiptFromRecipe(recipe, labelById);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      label_ingredient_id: 1, name: 'Oats', amount: '80', unit: 'g', source: 'recipe',
    });
    expect(lines[0].calories).toBeCloseTo(300, 5);
  });

  it('applies remembered amounts when present', () => {
    const recipe = {
      ingredients: [
        { kind: 'ingredient', name: 'Oats', amount: '40', unit: 'g', label_ingredient_id: 1 },
      ],
    };
    const lines = seedReceiptFromRecipe(recipe, labelById, { 1: { amount: '80', unit: 'g' } });
    expect(lines[0].amount).toBe('80');
    expect(lines[0].calories).toBeCloseTo(300, 5);
  });
});

describe('seedReceiptFromIngredientsJson', () => {
  it('rebuilds live macros for library ingredients', () => {
    const lines = seedReceiptFromIngredientsJson(
      [
        { name: 'Oats', label_ingredient_id: 1, amount: 80, unit: 'g', source: 'library' },
        { name: 'Egg', label_ingredient_id: 3, amount: 2, unit: 'egg', source: 'library' },
      ],
      labelById
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ label_ingredient_id: 1, name: 'Oats', amount: '80', unit: 'g' });
    expect(lines[0].calories).toBeCloseTo(300, 5);
    expect(lines[1]).toMatchObject({ label_ingredient_id: 3, name: 'Egg', amount: '2' });
    expect(lines[1].calories).toBeCloseTo(144, 5);
  });

  it('keeps orphaned rows with stored macros when the library id is gone', () => {
    const lines = seedReceiptFromIngredientsJson(
      [
        { name: 'Deleted blend', label_ingredient_id: 99, amount: 140, unit: 'g', calories: 90, protein_g: 1, carbs_g: 22, fat_g: 0.5 },
        { name: 'Oats', label_ingredient_id: 1, amount: 40, unit: 'g' },
      ],
      labelById
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      name: 'Deleted blend',
      label_ingredient_id: 99,
      amount: '140',
      calories: 90,
      source: 'estimated',
    });
    expect(lines[1].label_ingredient_id).toBe(1);
  });

  it('parses a JSON string and returns [] for empty/invalid input', () => {
    expect(seedReceiptFromIngredientsJson('[]', labelById)).toEqual([]);
    expect(seedReceiptFromIngredientsJson('not-json', labelById)).toEqual([]);
    expect(seedReceiptFromIngredientsJson(null, labelById)).toEqual([]);
    const lines = seedReceiptFromIngredientsJson(
      JSON.stringify([{ name: 'Oats', label_ingredient_id: 1, amount: 40, unit: 'g' }]),
      labelById
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].label_ingredient_id).toBe(1);
  });
});

describe('seedReceiptFromLoggedSelections', () => {
  it('seeds from historical slot_selections substitutions and amounts, not the recipe', () => {
    const lines = seedReceiptFromLoggedSelections(
      { s1: { label_ingredient_id: 3, amount: '2', unit: 'egg' } },
      labelById
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label_ingredient_id: 3, name: 'Egg', amount: '2' });
    expect(lines[0].calories).toBeCloseTo(144, 5);
  });

  it('parses a JSON string and skips unknown ids', () => {
    const lines = seedReceiptFromLoggedSelections(
      JSON.stringify({ s1: { label_ingredient_id: 1, amount: 40, unit: 'g' }, s2: { label_ingredient_id: 99, amount: 10, unit: 'g' } }),
      labelById
    );
    expect(lines.map(l => l.label_ingredient_id)).toEqual([1]);
  });
});

describe('sumReceiptMacros + receiptToApiIngredients', () => {
  it('sums scaled macros and shapes the POST /api/log payload', () => {
    const oatsLine = buildReceiptLine(oats, 80, 'g');
    const eggLine = buildReceiptLine(egg, 2, 'egg');
    const tot = sumReceiptMacros([oatsLine, eggLine]);
    expect(tot.calories).toBeCloseTo(300 + 144, 5);
    expect(tot.protein_g).toBeCloseTo(10 + 12, 5);

    const payload = receiptToApiIngredients([oatsLine, eggLine]);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      name: 'Oats', amount: 80, unit: 'g', source: 'library', label_ingredient_id: 1,
    });
    expect(payload[1]).toMatchObject({
      name: 'Egg', amount: 2, label_ingredient_id: 3,
    });
  });

  it('drops zero-amount or unscalable rows from the API payload', () => {
    const empty = { name: 'Skip', amount: 0, calories: 10, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const noCal = { name: 'Notes', amount: 1, calories: null };
    expect(receiptToApiIngredients([empty, noCal])).toEqual([]);
  });
});

describe('ghost amounts', () => {
  it('builds an empty amount with suggested serving and preview macros', () => {
    const line = buildGhostReceiptLine(oats);
    expect(line).toMatchObject({
      amount: '',
      suggested_amount: '40',
      unit: 'g',
      label_ingredient_id: 1,
    });
    expect(lineAmountIsEmpty(line)).toBe(true);
    expect(line.calories).toBeCloseTo(150, 5);
  });

  it('commits suggested amount on Enter / before submit', () => {
    const ghost = buildGhostReceiptLine(egg);
    const committed = commitLineSuggestedAmount(ghost, egg);
    expect(committed.amount).toBe('1');
    expect(committed.calories).toBeCloseTo(72, 5);
    expect(receiptToApiIngredients([ghost])).toEqual([]);
    expect(receiptToApiIngredients([committed])).toHaveLength(1);
  });

  it('commitAllSuggestedAmounts leaves typed amounts alone', () => {
    const ghost = buildGhostReceiptLine(oats);
    const typed = buildReceiptLine(egg, '2', 'egg');
    const next = commitAllSuggestedAmounts([ghost, typed], labelById);
    expect(next[0].amount).toBe('40');
    expect(next[1].amount).toBe('2');
  });
});

describe('adjacentReceiptLineId', () => {
  const lines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves forward and backward and clamps at ends', () => {
    expect(adjacentReceiptLineId(lines, null, 1)).toBe('a');
    expect(adjacentReceiptLineId(lines, 'a', 1)).toBe('b');
    expect(adjacentReceiptLineId(lines, 'c', 1)).toBe('c');
    expect(adjacentReceiptLineId(lines, 'b', -1)).toBe('a');
    expect(adjacentReceiptLineId(lines, 'a', -1)).toBe('a');
  });
});

describe('generateMealName', () => {
  it('joins up to three ingredient names', () => {
    expect(generateMealName([
      { name: 'Oats' },
      { name: 'Egg' },
      { name: 'Milk' },
    ])).toBe('Oats + Egg + Milk');
  });

  it('summarizes longer lists', () => {
    expect(generateMealName([
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
      { name: 'D' },
    ])).toBe('A + B + C + 1 more');
  });

  it('returns empty when there are no names', () => {
    expect(generateMealName([])).toBe('');
    expect(generateMealName([{ name: '  ' }])).toBe('');
  });
});

// Nonfat milk recorded as "1 cup", one cup weighed at 245 g.
const milk = {
  id: 7, name: 'Nonfat milk', tracking_type: 'unit', unit_name: 'cup',
  serving_quantity: 1, grams_per_unit: 245,
  calories: 90, protein_g: 9, carbs_g: 13, fat_g: 0.5,
};

describe('changeLineUnit', () => {
  const line = buildReceiptLine(milk, '1', 'cup');

  it('restates the amount so the food stays the same', () => {
    expect(changeLineUnit(line, milk, 'ml')).toEqual({ amount: '236.59', unit: 'ml' });
    expect(changeLineUnit(line, milk, 'g')).toEqual({ amount: '245', unit: 'g' });
    expect(changeLineUnit(line, milk, 'fl oz')).toEqual({ amount: '8', unit: 'fl oz' });
  });

  it('round-trips back to the original unit', () => {
    const inMl = { ...line, ...changeLineUnit(line, milk, 'ml') };
    expect(Number(changeLineUnit(inMl, milk, 'cup').amount)).toBeCloseTo(1, 4);
  });

  it('keeps the macros right after the switch', () => {
    const patch = changeLineUnit(line, milk, 'ml');
    const converted = buildReceiptLine(milk, patch.amount, patch.unit);
    expect(converted.calories).toBeCloseTo(90, 1);
    // Half a cup is half the macros, whatever unit says so.
    const half = buildReceiptLine(milk, '118.29', 'ml');
    expect(half.calories).toBeCloseTo(45, 1);
  });

  it('refuses a unit the ingredient cannot be measured in', () => {
    expect(changeLineUnit(line, milk, 'slice')).toBeNull();
    expect(changeLineUnit(line, oats, 'ml')).toBeNull(); // grams-per-serving: no density
  });
});

describe('retargetLineToIngredient', () => {
  it('keeps the amount when the new ingredient takes the same unit', () => {
    const line = buildReceiptLine(oats, '150', 'g');
    expect(retargetLineToIngredient(line, { ...oats, id: 2 })).toEqual({ amount: '150', unit: 'g' });
  });

  it('resets rather than relabelling an amount onto a foreign unit', () => {
    // "150 g" must not become "150 eggs" just because the swap was accepted.
    const line = buildReceiptLine(oats, '150', 'g');
    expect(retargetLineToIngredient(line, egg)).toEqual({ amount: '1', unit: 'egg' });
  });

  it('carries a weight across to an ingredient that knows what one weighs', () => {
    const line = buildReceiptLine(oats, '245', 'g');
    expect(retargetLineToIngredient(line, milk)).toEqual({ amount: '245', unit: 'g' });
  });
});

describe('buildRecipeFromReceipt', () => {
  const receipt = [
    buildReceiptLine(oats, '90', 'g'),
    buildReceiptLine(egg, '2', 'egg'),
  ];

  it('keeps library rows linked so the saved recipe stays editable', () => {
    const body = buildRecipeFromReceipt(receipt, 'Morning bowl');
    expect(body.name).toBe('Morning bowl');
    expect(body.serving_size).toBe('1 meal');
    expect(body.ingredients).toEqual([
      { kind: 'ingredient', name: 'Oats', amount: '90', unit: 'g', label_ingredient_id: 1 },
      { kind: 'ingredient', name: 'Egg', amount: '2', unit: 'egg', label_ingredient_id: 3 },
    ]);
    expect(body.meal_builder_meta).toEqual({ source: 'log_receipt' });
  });

  it('totals the receipt', () => {
    const body = buildRecipeFromReceipt(receipt, 'Morning bowl');
    // 90 g of oats (150 cal per 40 g) + 2 eggs at 72.
    expect(body.calories).toBeCloseTo(150 * (90 / 40) + 144, 1);
    expect(body.protein_g).toBeCloseTo(5 * (90 / 40) + 12, 1);
  });

  it('carries the unit the line was actually measured in', () => {
    const body = buildRecipeFromReceipt([buildReceiptLine(milk, '200', 'ml')], 'Milk');
    expect(body.ingredients[0]).toMatchObject({ unit: 'ml', amount: '200' });
  });

  it('keeps a row with no library link visible instead of dropping it', () => {
    const legacy = { id: 'x', name: 'Everything seasoning', amount: '', unit: '', calories: null };
    const body = buildRecipeFromReceipt([...receipt, legacy], 'Bowl');
    expect(body.ingredients).toHaveLength(3);
    expect(body.ingredients[2]).toEqual({ kind: 'line', name: 'Everything seasoning', amount: 'as logged' });
  });

  it('refuses to build without a name or without lines', () => {
    expect(buildRecipeFromReceipt(receipt, '   ')).toBeNull();
    expect(buildRecipeFromReceipt(receipt, null)).toBeNull();
    expect(buildRecipeFromReceipt([], 'Empty')).toBeNull();
    expect(buildRecipeFromReceipt(null, 'Empty')).toBeNull();
  });

  it('trims the name', () => {
    expect(buildRecipeFromReceipt(receipt, '  Morning bowl  ').name).toBe('Morning bowl');
  });

  it('splits an equal meal prep into a limited per-serving recipe', () => {
    const body = buildRecipeFromReceipt(receipt, 'Chicken prep', { mealPrepServings: 4 });
    expect(body.recipe_kind).toBe('limited');
    expect(body.remaining_uses).toBe(4);
    expect(body.max_uses).toBe(4);
    expect(body.serving_size).toBe('1 of 4 meal-prep servings');
    expect(body.meal_builder_meta).toMatchObject({ source: 'log_meal_prep', split: 'equal' });
    expect(body.ingredients[0].amount).toBe('22.5'); // 90 / 4
    expect(body.ingredients[1].amount).toBe('0.5'); // 2 / 4
    const full = buildRecipeFromReceipt(receipt, 'Chicken prep');
    expect(body.calories).toBeCloseTo(full.calories / 4, 1);
  });
});

describe('buildUnequalMealPrepRecipes', () => {
  const receipt = [
    buildReceiptLine(oats, '100', 'g'),
    buildReceiptLine(egg, '2', 'egg'),
  ];

  it('builds one limited recipe per container from percentages', () => {
    const bodies = buildUnequalMealPrepRecipes(receipt, 'Batch', [50, 30, 20]);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({
      name: 'Batch (1/3)',
      recipe_kind: 'limited',
      remaining_uses: 1,
      max_uses: 1,
    });
    expect(bodies[0].ingredients[0].amount).toBe('50');
    expect(bodies[1].ingredients[0].amount).toBe('30');
    expect(bodies[2].ingredients[0].amount).toBe('20');
    expect(bodies[0].meal_builder_meta).toMatchObject({ source: 'log_meal_prep', split: 'custom' });
  });

  it('rejects invalid weights', () => {
    expect(buildUnequalMealPrepRecipes(receipt, 'Batch', [50])).toBeNull();
    expect(buildUnequalMealPrepRecipes(receipt, 'Batch', [50, -10])).toBeNull();
    expect(buildUnequalMealPrepRecipes(receipt, '  ', [50, 50])).toBeNull();
  });
});

describe('normalizeMealPrepFractions', () => {
  it('normalizes percents to fractions that sum to 1', () => {
    const f = normalizeMealPrepFractions([50, 50]);
    expect(f).toEqual([0.5, 0.5]);
  });
});

describe('remembered amounts round-trip their unit', () => {
  const recipe = {
    id: 10,
    ingredients: [{ kind: 'ingredient', name: 'Milk', amount: '1', unit: 'cup', label_ingredient_id: 7 }],
  };
  const byId = { 7: milk };

  it('comes back in the unit it was last logged in', () => {
    const lines = seedReceiptFromRecipe(recipe, byId, { 7: { amount: '200', unit: 'ml' } });
    expect(lines[0]).toMatchObject({ amount: '200', unit: 'ml' });
    expect(lines[0].calories).toBeCloseTo(90 * (200 / 236.5882365), 1);
  });

  it('falls back to the ingredient own unit when the remembered one no longer fits', () => {
    const lines = seedReceiptFromRecipe(recipe, byId, { 7: { amount: '2', unit: 'slice' } });
    expect(lines[0].unit).toBe('cup');
  });
});

describe('buildRecipeFromLogEntry', () => {
  const entry = {
    id: 5,
    servings: 2,
    recipe_calories: 400, recipe_protein_g: 30, recipe_carbs_g: 40, recipe_fat_g: 10,
    ingredients_json: JSON.stringify([
      { name: 'Oats', amount: 90, unit: 'g', calories: 337.5, protein_g: 11.25, carbs_g: 60.75, fat_g: 6.75, label_ingredient_id: 1 },
      { name: 'Egg', amount: 2, unit: 'egg', calories: 144, protein_g: 12, carbs_g: 0.8, fat_g: 10, label_ingredient_id: 3 },
    ]),
  };

  it('saves the per-serving lines, not the whole log', () => {
    // The entry is two servings; the recipe is still for one.
    const body = buildRecipeFromLogEntry(entry, 'Oat bowl');
    expect(body.ingredients).toEqual([
      { kind: 'ingredient', name: 'Oats', amount: '90', unit: 'g', label_ingredient_id: 1 },
      { kind: 'ingredient', name: 'Egg', amount: '2', unit: 'egg', label_ingredient_id: 3 },
    ]);
    expect(body.calories).toBeCloseTo(481.5, 1);
  });

  it('falls back to the meal own macros when it has no breakdown', () => {
    const plain = { ...entry, ingredients_json: null };
    const body = buildRecipeFromLogEntry(plain, 'Just macros');
    expect(body.ingredients).toEqual([]);
    expect(body.calories).toBe(400);
    expect(body.meal_builder_meta).toEqual({ source: 'log_entry' });
  });

  it('needs a name and a meal', () => {
    expect(buildRecipeFromLogEntry(entry, '  ')).toBeNull();
    expect(buildRecipeFromLogEntry(null, 'x')).toBeNull();
    expect(buildRecipeFromLogEntry({ ingredients_json: null }, 'x')).toBeNull();
  });
});

describe('augmentMealPrepRecipe', () => {
  const potato = {
    id: 10, name: 'Potato', tracking_type: 'weight', grams_per_serving: 150,
    calories: 200, protein_g: 5, carbs_g: 30, fat_g: 8, fiber_g: 2,
  };
  const prepRecipe = {
    name: 'Potato salad',
    serving_size: '1 of 4 meal-prep servings',
    calories: 200,
    protein_g: 5,
    carbs_g: 30,
    fat_g: 8,
    fiber_g: 2,
    recipe_kind: 'limited',
    remaining_uses: 3,
    max_uses: 4,
    meal_builder_meta: { source: 'log_meal_prep', containers: 4, split: 'equal' },
    ingredients: [
      { kind: 'ingredient', name: 'Potato', amount: '150', unit: 'g', label_ingredient_id: 10 },
    ],
  };

  it('detects equal-split meal preps', () => {
    expect(isEqualSplitMealPrep(prepRecipe)).toBe(true);
    expect(mealPrepContainerCount(prepRecipe)).toBe(4);
    expect(isEqualSplitMealPrep({ ...prepRecipe, meal_builder_meta: { split: 'custom' } })).toBe(false);
  });

  it('splits added ingredients across containers', () => {
    const added = [
      buildReceiptLine(oats, '400', 'g', { id: 'a1' }),
    ];
    const body = augmentMealPrepRecipe(prepRecipe, added, { splitBy: 4 });
    expect(body).not.toBeNull();
    expect(body.ingredients).toHaveLength(2);
    expect(body.ingredients).toEqual(expect.arrayContaining([
      { kind: 'ingredient', name: 'Oats', amount: '100', unit: 'g', label_ingredient_id: 1 },
      { kind: 'ingredient', name: 'Potato', amount: '150', unit: 'g', label_ingredient_id: 10 },
    ]));
    expect(body.calories).toBeCloseTo(200 + 375, 0);
    expect(body.protein_g).toBeCloseTo(5 + 12.5, 0);
  });

  it('merges when the same ingredient is added again', () => {
    const added = [buildReceiptLine(potato, '300', 'g', { id: 'a1' })];
    const body = augmentMealPrepRecipe(prepRecipe, added, { splitBy: 4 });
    expect(body.ingredients).toHaveLength(1);
    expect(body.ingredients[0].amount).toBe('225');
  });

  it('rejects empty additions', () => {
    expect(augmentMealPrepRecipe(prepRecipe, [], { splitBy: 4 })).toBeNull();
  });
});
