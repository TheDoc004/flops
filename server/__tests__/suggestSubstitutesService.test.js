const { suggestSubstitutes } = require('../suggestSubstitutesService');
const { callProviderJson } = require('../aiClient');

jest.mock('../aiClient', () => {
  const actual = jest.requireActual('../aiClient');
  return { ...actual, callProviderJson: jest.fn() };
});

describe('suggestSubstitutes', () => {
  beforeEach(() => {
    callProviderJson.mockReset();
  });

  it('drops hallucinated ids that are not in the provided library', async () => {
    callProviderJson.mockResolvedValue(JSON.stringify({
      suggestions: [
        { label_ingredient_id: 999, reason: 'made up' },
        { label_ingredient_id: 2, reason: 'same category' },
        { label_ingredient_id: 2, reason: 'duplicate' },
      ],
    }));
    const res = await suggestSubstitutes({
      ingredient: { name: 'Bread' },
      library: [{ id: 2, name: 'Toast' }, { id: 3, name: 'Bagel' }],
      limit: 5,
    });
    expect(res.suggestions).toEqual([{ label_ingredient_id: 2, reason: 'same category' }]);
  });

  it('returns an empty list when nothing in the library matches', async () => {
    callProviderJson.mockResolvedValue('{"suggestions":[{"label_ingredient_id":1}]}');
    const res = await suggestSubstitutes({
      ingredient: { name: 'Bread' },
      library: [{ id: 2, name: 'Toast' }],
    });
    expect(res.suggestions).toEqual([]);
  });
});
