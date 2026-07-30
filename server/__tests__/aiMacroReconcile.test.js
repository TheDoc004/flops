const { unreconciledRows, macroCalories, estimateMacros } = require('../aiMacroService');

const row = over => ({ name: 'Item', calories: 0, protein: 0, carbs: 0, fat: 0, ...over });

describe('macroCalories', () => {
  it('applies Atwater factors', () => {
    expect(macroCalories({ protein: 10, carbs: 10, fat: 10 })).toBe(170);
    expect(macroCalories({})).toBe(0);
  });
});

describe('unreconciledRows', () => {
  it('catches the bug: calories stated, macros left at zero', () => {
    // "190 calorie Rice Krispie treat" coming back as 190/0/0/0.
    const flagged = unreconciledRows([row({ name: 'Rice Krispie treat', calories: 190 })]);
    expect(flagged).toHaveLength(1);
  });

  it('passes a row whose macros explain its calories', () => {
    // A real Rice Krispie treat: ~1.5p / 38c / 3.5f ≈ 190 cal.
    const ok = row({ name: 'Rice Krispie treat', calories: 190, protein: 1.5, carbs: 38, fat: 3.5 });
    expect(unreconciledRows([ok])).toHaveLength(0);
  });

  it('ignores genuinely near-zero foods', () => {
    expect(unreconciledRows([row({ name: 'Black coffee', calories: 2 })])).toHaveLength(0);
    expect(unreconciledRows([row({ name: 'Cinnamon', calories: 6 })])).toHaveLength(0);
  });

  it('still flags severe under-reporting, not just zeros', () => {
    // 300 cal claimed but macros only account for 80.
    const under = row({ name: 'Pasta', calories: 300, protein: 5, carbs: 15, fat: 0 });
    expect(unreconciledRows([under])).toHaveLength(1);
  });
});

describe('estimateMacros — reconciliation warning', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete global.fetch;
  });

  const mockAi = obj => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
    }));
  };

  it('warns the user when a row cannot be reconciled', async () => {
    mockAi({
      mealName: 'Snack',
      ingredients: [{ name: 'Rice Krispie treat', quantity: 1, unit: 'bar', calories: 190, protein: 0, carbs: 0, fat: 0 }],
      totals: { calories: 190, protein: 0, carbs: 0, fat: 0 },
      warnings: [],
    });
    const r = await estimateMacros({ description: '190 calorie rice krispie treat' });
    expect(r.warnings.join(' ')).toMatch(/Rice Krispie treat.*don't add up to the calories/i);
  });

  it('stays quiet when the numbers hold together', async () => {
    mockAi({
      mealName: 'Snack',
      ingredients: [{ name: 'Rice Krispie treat', quantity: 1, unit: 'bar', calories: 190, protein: 1.5, carbs: 38, fat: 3.5 }],
      totals: { calories: 190, protein: 1.5, carbs: 38, fat: 3.5 },
      warnings: [],
    });
    const r = await estimateMacros({ description: '190 calorie rice krispie treat' });
    expect(r.warnings.join(' ')).not.toMatch(/add up to the calories/i);
  });

  it('notes alcohol as the legitimate exception', async () => {
    mockAi({
      mealName: 'Drink',
      ingredients: [{ name: 'Vodka soda', quantity: 1, unit: 'drink', calories: 97, protein: 0, carbs: 0, fat: 0 }],
      totals: { calories: 97, protein: 0, carbs: 0, fat: 0 },
      warnings: [],
    });
    const r = await estimateMacros({ description: 'a vodka soda' });
    expect(r.warnings.join(' ')).toMatch(/expected for alcohol/i);
  });
});
