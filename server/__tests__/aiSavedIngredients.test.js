/**
 * The AI logger used to normalize "1 filet of salmon" to grams because the model
 * never saw the user's ingredient library. These tests read the prompt that
 * actually goes over the wire, plus what comes back out of validation.
 */
const { estimateMacros } = require('../aiMacroService');

const OLD_ENV = { ...process.env };
let lastBody;

beforeEach(() => {
  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'test';
  lastBody = null;
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  delete global.fetch;
});

const mockAi = obj => {
  global.fetch = jest.fn(async (_url, init) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
  });
};

const plainReply = {
  mealName: 'Dinner',
  ingredients: [{ name: 'Salmon', quantity: 1, unit: 'filet', calories: 350, protein: 34, carbs: 0, fat: 22 }],
  totals: { calories: 350, protein: 34, carbs: 0, fat: 22 },
};

/** Everything the model was told, system prompt and user message together. */
const promptText = () => lastBody.messages.map(m => m.content).join('\n');

const savedIngredients = [
  { name: 'Salmon', unit: 'filet', gramsPerUnit: 170 },
  { name: 'Nonfat milk', unit: 'cup', gramsPerUnit: 245 },
  { name: 'Oats', unit: 'g' },
];

describe('the saved-ingredient list reaches the model', () => {
  it('lists each ingredient with the unit it is measured in', async () => {
    mockAi(plainReply);
    await estimateMacros({ description: '1 filet of salmon', savedIngredients });
    const text = promptText();
    expect(text).toContain('Salmon (measured in: filet; 1 filet = 170 g)');
    expect(text).toContain('Nonfat milk (measured in: cup; 1 cup = 245 g)');
    // A gram-measured item has no useful "1 g = 1 g" note.
    expect(text).toContain('Oats (measured in: g)');
    expect(text).not.toContain('1 g = 1 g');
  });

  it('says so explicitly when the library is empty', async () => {
    mockAi(plainReply);
    await estimateMacros({ description: 'some salmon' });
    expect(promptText()).toContain('no saved ingredients');
  });

  it('instructs the model to keep the unit the user said', async () => {
    mockAi(plainReply);
    await estimateMacros({ description: '1 filet of salmon', savedIngredients });
    const text = promptText();
    expect(text).toMatch(/NEVER convert it to grams/);
    expect(text).toMatch(/"1 filet of salmon" is quantity 1, unit "filet"/);
  });
});

describe('the match the model reports', () => {
  it('carries savedIngredient through validation', async () => {
    mockAi({
      ...plainReply,
      ingredients: [{ ...plainReply.ingredients[0], savedIngredient: 'Salmon' }],
    });
    const r = await estimateMacros({ description: '1 filet of salmon', savedIngredients });
    expect(r.ingredients[0].savedIngredient).toBe('Salmon');
    // And the unit survives rather than becoming grams.
    expect(r.ingredients[0].unit).toBe('filet');
    expect(r.ingredients[0].quantity).toBe(1);
  });

  it('is null when the model names nothing', async () => {
    mockAi(plainReply);
    const r = await estimateMacros({ description: '1 filet of salmon', savedIngredients });
    expect(r.ingredients[0].savedIngredient).toBeNull();
  });

  it('is null rather than a stray non-string', async () => {
    mockAi({
      ...plainReply,
      ingredients: [{ ...plainReply.ingredients[0], savedIngredient: { name: 'Salmon' } }],
    });
    const r = await estimateMacros({ description: 'salmon', savedIngredients });
    expect(r.ingredients[0].savedIngredient).toBeNull();
  });
});

describe('revisions keep the match', () => {
  it('shows the baseline match back to the model', async () => {
    mockAi(plainReply);
    await estimateMacros({
      description: '1 filet of salmon',
      corrections: ['make it two'],
      currentEstimate: {
        mealName: 'Dinner',
        ingredients: [{
          name: 'Salmon', quantity: 1, unit: 'filet', state: 'unknown',
          calories: 350, protein: 34, carbs: 0, fat: 22,
          macroSource: 'estimated', savedIngredient: 'Salmon',
        }],
      },
      savedIngredients,
    });
    expect(promptText()).toContain('[saved ingredient: Salmon]');
  });
});
