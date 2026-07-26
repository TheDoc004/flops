const { scanSupplementLabel, shapeMacros } = require('../supplementLabelService');

const IMG = 'data:image/jpeg;base64,QUJD';

function mockAiJson(obj) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(obj) } }], // OpenAI shape
    }),
  }));
}

describe('supplementLabelService.shapeMacros', () => {
  it('keeps macros when any value is present', () => {
    expect(shapeMacros({ calories: 10, protein_g: 0, carbs_g: 0, fat_g: 0 }))
      .toEqual({ calories: 10, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
  it('returns null when all macros are zero/absent', () => {
    expect(shapeMacros({ calories: 0 })).toBeNull();
    expect(shapeMacros(null)).toBeNull();
  });
});

describe('supplementLabelService.scanSupplementLabel', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete global.fetch;
  });

  it('shapes a well-formed label response and whitelists micros', async () => {
    mockAiJson({
      name: '  Men\'s Multivitamin  ',
      dose_text: ' 2 tablets ',
      macros: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      micros: { vitamin_d_mcg: 25, iron_mg: 8, not_a_nutrient: 999 },
      confidence: 'high',
      notes: 'clear panel',
    });
    const r = await scanSupplementLabel({ imageDataUrl: IMG });
    expect(r.name).toBe("Men's Multivitamin");
    expect(r.dose_text).toBe('2 tablets');
    expect(r.micros).toEqual({ vitamin_d_mcg: 25, iron_mg: 8 }); // unknown key dropped
    expect(r.macros).toBeNull(); // all-zero macros
    expect(r.confidence).toBe('high');
  });

  it('returns empty micros and keeps macros when the panel has calories', async () => {
    mockAiJson({
      name: 'Protein Powder',
      dose_text: '1 scoop',
      macros: { calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5 },
      micros: {},
      confidence: 'medium',
    });
    const r = await scanSupplementLabel({ imageDataUrl: IMG });
    expect(r.micros).toEqual({});
    expect(r.macros).toEqual({ calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5 });
  });

  it('defaults confidence to low and tolerates missing fields', async () => {
    mockAiJson({ micros: { calcium_mg: 200 } });
    const r = await scanSupplementLabel({ imageDataUrl: IMG });
    expect(r.name).toBe('');
    expect(r.dose_text).toBe('');
    expect(r.confidence).toBe('low');
    expect(r.micros).toEqual({ calcium_mg: 200 });
  });
});
