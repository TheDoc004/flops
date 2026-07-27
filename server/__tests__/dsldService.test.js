const {
  searchSupplements,
  fetchSupplementLabel,
  mapIngredientRow,
  servingText,
  DsldError,
} = require('../dsldService');

/** Shapes copied from real DSLD responses, quirks included. */
const row = (group, name, quantity, unit) => ({
  ingredientGroup: group,
  name,
  quantity: [{ servingSizeOrder: 1, quantity, unit, servingSizeUnit: 'Tablet(s)' }],
});

const CENTRUM = {
  fullName: 'Centrum Men Under 50',
  brandName: 'Centrum',
  entryDate: '2013-01-25',
  offMarket: 0,
  upcSku: '300054294128',
  servingSizes: [{ order: 1, minQuantity: 1, maxQuantity: 1, unit: 'Tablet(s)' }],
  ingredientRows: [
    row('Vitamin A', 'Vitamin A', 3500, 'IU'),
    row('Vitamin C', 'Vitamin C', 90, 'mg'),
    row('Vitamin D', 'Vitamin D', 600, 'IU'),
    row('Vitamin E', 'Vitamin E', 45, 'IU'), // tracked by neither map
    row('Calcium', 'Calcium', 210, 'mg'),
    row('Iron', 'Iron', 8, 'mg'),
    row('Folate', 'Folate', 200, 'mcg DFE'),
    row('Vitamin B12', 'Vitamin B12', 6, 'mcg'),
  ],
};

// A protein powder: DSLD qualifies these groups and spells units as words.
const WHEY = {
  fullName: 'Gold Standard 100% Whey Strawberry',
  brandName: 'ON Optimum Nutrition',
  entryDate: '2016-03-01',
  offMarket: 0,
  servingSizes: [{ order: 1, minQuantity: 32, unit: 'Gram(s)' }],
  ingredientRows: [
    row('Calories', 'Calories', 130, 'Calorie(s)'),
    row('Protein (unspecified)', 'Protein', 24, 'Gram(s)'),
    row('Fat (unspecified)', 'Total Fat', 1, 'Gram(s)'),
    row('Carbohydrate', 'Total Carbohydrates', 5, 'Gram(s)'),
    row('Sodium', 'Sodium', 60, 'mg'),
  ],
};

const okFetch = payload => jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));

describe('servingText', () => {
  it('cleans up DSLD\'s plural marker', () => {
    expect(servingText({ servingSizes: [{ minQuantity: 1, unit: 'Tablet(s)' }] })).toBe('1 Tablet');
    expect(servingText({ servingSizes: [{ minQuantity: 2, unit: 'Capsule(s)' }] })).toBe('2 Capsules');
  });
  it('returns empty when there is no serving size', () => {
    expect(servingText({})).toBe('');
  });
});

describe('mapIngredientRow', () => {
  it('converts IU for the vitamins where that is defined', () => {
    expect(mapIngredientRow(row('Vitamin D', 'Vitamin D', 600, 'IU'))).toMatchObject({
      key: 'vitamin_d_mcg',
      value: 15,
      converted: true,
    });
  });

  it('reads word-form units', () => {
    expect(mapIngredientRow(row('Dietary Fiber', 'Fiber', 3, 'Gram(s)'))).toMatchObject({
      key: 'fiber_g',
      value: 3,
    });
  });

  it('scales between mass units', () => {
    expect(mapIngredientRow(row('Calcium', 'Calcium', 0.21, 'g'))).toMatchObject({ key: 'calcium_mg', value: 210 });
    expect(mapIngredientRow(row('Vitamin B12', 'Vitamin B12', 0.006, 'mg'))).toMatchObject({
      key: 'vitamin_b12_mcg',
      value: 6,
    });
  });

  it('skips nutrients this app does not track', () => {
    expect(mapIngredientRow(row('Vitamin E', 'Vitamin E', 45, 'IU'))).toBeNull();
    expect(mapIngredientRow(row('Selenium', 'Selenium', 55, 'mcg'))).toBeNull();
  });

  it('skips an IU value it cannot convert', () => {
    expect(mapIngredientRow(row('Calcium', 'Calcium', 100, 'IU'))).toBeNull();
  });
});

describe('fetchSupplementLabel', () => {
  it('maps a multivitamin into canonical keys and flags conversions', async () => {
    const label = await fetchSupplementLabel('17144', { fetchImpl: okFetch(CENTRUM) });
    expect(label.name).toBe('Centrum Men Under 50');
    expect(label.brand).toBe('Centrum');
    expect(label.dose_text).toBe('1 Tablet');
    expect(label.micros).toEqual({
      vitamin_a_mcg: 1050, // 3500 IU retinol
      vitamin_c_mg: 90,
      vitamin_d_mcg: 15, // 600 IU
      calcium_mg: 210,
      iron_mg: 8,
      folate_mcg: 200,
      vitamin_b12_mcg: 6,
    });
    expect(label.confidence).toBe('high');
    expect(label.notes).toMatch(/Converted to standard units/);
    expect(label.notes).toMatch(/Vitamin E/); // told about what it dropped
    expect(label.untracked_count).toBe(1);
  });

  it('reads macros off a protein powder despite qualified group names', async () => {
    const label = await fetchSupplementLabel('218575', { fetchImpl: okFetch(WHEY) });
    // The regression that made protein read 0: group is "Protein (unspecified)"
    // and the unit is the word "Gram(s)".
    expect(label.macros).toEqual({ calories: 130, protein_g: 24, carbs_g: 5, fat_g: 1 });
    expect(label.micros).toEqual({ sodium_mg: 60 });
    expect(label.dose_text).toBe('32 Grams');
  });

  it('sums a nutrient listed more than once', async () => {
    const label = await fetchSupplementLabel('1', {
      fetchImpl: okFetch({
        fullName: 'Double Magnesium',
        servingSizes: [{ minQuantity: 1, unit: 'Capsule(s)' }],
        ingredientRows: [
          row('Magnesium', 'Magnesium Oxide', 100, 'mg'),
          row('Magnesium', 'Magnesium Citrate', 50, 'mg'),
        ],
      }),
    });
    expect(label.micros.magnesium_mg).toBe(150);
  });

  it('warns when the product is off-market', async () => {
    const label = await fetchSupplementLabel('1', { fetchImpl: okFetch({ ...CENTRUM, offMarket: 1 }) });
    expect(label.off_market).toBe(true);
    expect(label.notes).toMatch(/off-market/i);
  });

  it('returns null when the id is gone', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await fetchSupplementLabel('999', { fetchImpl })).toBeNull();
  });

  it('rejects a non-numeric id without calling out', async () => {
    const fetchImpl = jest.fn();
    await expect(fetchSupplementLabel('abc', { fetchImpl })).rejects.toBeInstanceOf(DsldError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('searchSupplements', () => {
  const hits = payload => okFetch({ hits: payload });
  const hit = (id, over = {}) => ({
    _id: id,
    _source: {
      fullName: 'Centrum Men',
      brandName: 'Centrum',
      offMarket: 0,
      entryDate: '2021-01-01',
      physicalState: { langualCodeDescription: 'Tablet or Pill' },
      netContents: [{ display: '100 Tablet(s)' }],
      allIngredients: new Array(40).fill({}),
      ...over,
    },
  });

  it('shapes results and ranks off-market products last', async () => {
    const fetchImpl = hits([
      hit('1', { fullName: 'Old Formula', offMarket: 1, entryDate: '2010-01-01' }),
      hit('2', { fullName: 'Current' }),
    ]);
    const results = await searchSupplements('brand', { fetchImpl });
    expect(results.map(r => r.id)).toEqual(['2', '1']);
    expect(results[1].off_market).toBe(true);
  });

  it('carries the fields that tell near-identical products apart', async () => {
    const results = await searchSupplements('centrum', { fetchImpl: hits([hit('1')]) });
    expect(results[0]).toMatchObject({
      form: 'Tablet',
      net_contents: '100 Tablets', // DSLD's "(s)" cleaned up
      nutrient_count: 40,
    });
  });

  it('tidies awkward plural markers', async () => {
    const results = await searchSupplements('gummy', {
      fetchImpl: hits([hit('1', { netContents: [{ display: '120 Gummy(ies)' }] })]),
    });
    expect(results[0].net_contents).toBe('120 Gummies');
  });

  it('collapses repeat versions of one product, keeping the newest label', async () => {
    // The real "centrum men" problem: one product, three label entries.
    const fetchImpl = hits([
      hit('old', { entryDate: '2013-01-25', allIngredients: new Array(80).fill({}) }),
      hit('newest', { entryDate: '2021-08-23' }),
      hit('middle', { entryDate: '2019-07-24' }),
    ]);
    const results = await searchSupplements('centrum men', { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('newest');
    // Older labels stay reachable, newest first.
    expect(results[0].older_versions.map(v => v.id)).toEqual(['middle', 'old']);
  });

  it('prefers a current label over a newer discontinued one', async () => {
    const fetchImpl = hits([
      hit('current', { entryDate: '2018-01-01', offMarket: 0 }),
      hit('discontinued', { entryDate: '2022-01-01', offMarket: 1 }),
    ]);
    const results = await searchSupplements('centrum men', { fetchImpl });
    expect(results[0].id).toBe('current');
    expect(results[0].older_versions[0].id).toBe('discontinued');
  });

  it('keeps genuinely different products apart', async () => {
    const fetchImpl = hits([
      hit('1', { fullName: 'Centrum Men' }),
      hit('2', { fullName: 'Centrum Silver Men 50+' }),
      hit('3', { fullName: 'Centrum Men', brandName: 'GSK' }), // same name, other brand
    ]);
    const results = await searchSupplements('centrum', { fetchImpl });
    expect(results).toHaveLength(3);
  });

  it('does not call out for a too-short query', async () => {
    const fetchImpl = jest.fn();
    expect(await searchSupplements('a', { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops malformed hits', async () => {
    const fetchImpl = hits([{ _id: '', _source: { fullName: 'No id' } }, { _id: '3', _source: {} }]);
    expect(await searchSupplements('x', { fetchImpl })).toEqual([]);
  });

  it('raises a DsldError when the database is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(searchSupplements('centrum', { fetchImpl })).rejects.toBeInstanceOf(DsldError);
  });
});
