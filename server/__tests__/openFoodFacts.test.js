const {
  lookupBarcode,
  shapeOffProduct,
  normalizeBarcode,
  BarcodeLookupError,
  BarcodeNotFoundError,
} = require('../openFoodFactsService');

/** A product with both per-serving and per-100g nutriments (the good case). */
const NUTELLA = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  quantity: '400 g',
  serving_size: '15 g',
  serving_quantity: 15,
  serving_quantity_unit: 'g',
  nutrition_data_per: 'serving',
  nutriments: {
    'energy-kcal_100g': 539,
    'energy-kcal_serving': 80.9,
    proteins_100g: 6.3,
    proteins_serving: 0.945,
    carbohydrates_100g: 57.5,
    carbohydrates_serving: 8.63,
    fat_100g: 30.9,
    fat_serving: 4.64,
    fiber_100g: 0,
  },
  image_front_small_url: 'https://example.test/nutella.jpg',
};

function mockFetchProduct(product, { status = 200 } = {}) {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (product ? { code: product.code, status: 1, product } : { status: 0 }),
  }));
}

describe('normalizeBarcode', () => {
  it('keeps digits and accepts EAN-8 through GTIN-14', () => {
    expect(normalizeBarcode('3017620422003')).toBe('3017620422003');
    expect(normalizeBarcode(' 0123-4567 ')).toBe('01234567');
    expect(normalizeBarcode(12345678901234)).toBe('12345678901234');
  });
  it('rejects anything too short, too long, or empty', () => {
    expect(normalizeBarcode('1234567')).toBeNull();
    expect(normalizeBarcode('123456789012345')).toBeNull();
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });
});

describe('shapeOffProduct', () => {
  it('prefers per-serving values when the product has a serving size', () => {
    const r = shapeOffProduct(NUTELLA, '3017620422003');
    expect(r.basis).toBe('serving');
    expect(r.name).toBe('Nutella');
    expect(r.brand_name).toBe('Ferrero'); // first brand only
    expect(r.serving_amount).toBe(15);
    expect(r.serving_unit).toBe('g');
    expect(r.macros).toEqual({
      calories: 80.9,
      protein_g: 0.95,
      carbs_g: 8.63,
      fat_g: 4.64,
      fiber_g: null, // no fiber_serving on record
    });
  });

  it('derives per-serving macros when only per-100g values exist', () => {
    const r = shapeOffProduct(
      {
        product_name: 'Oats',
        serving_quantity: 40,
        serving_quantity_unit: 'g',
        nutriments: { 'energy-kcal_100g': 380, proteins_100g: 13, carbohydrates_100g: 60, fat_100g: 7, fiber_100g: 10 },
      },
      '1234567890'
    );
    expect(r.basis).toBe('serving_derived');
    expect(r.serving_amount).toBe(40);
    expect(r.macros).toEqual({ calories: 152, protein_g: 5.2, carbs_g: 24, fat_g: 2.8, fiber_g: 4 });
  });

  it('falls back to a 100 g basis when no serving size is on record', () => {
    const r = shapeOffProduct(
      { product_name: 'Flour', nutriments: { 'energy-kcal_100g': 364, proteins_100g: 10, carbohydrates_100g: 76, fat_100g: 1 } },
      '1234567890'
    );
    expect(r.basis).toBe('100g');
    expect(r.serving_amount).toBe(100);
    expect(r.serving_unit).toBe('g');
    expect(r.macros.calories).toBe(364);
  });

  it('converts kilojoules when no kcal value is present', () => {
    const r = shapeOffProduct({ product_name: 'X', nutriments: { energy_100g: 1000, proteins_100g: 5 } }, '1234567890');
    expect(r.macros.calories).toBe(239.01); // 1000 / 4.184
  });

  it('keeps ml as the unit for liquid servings', () => {
    const r = shapeOffProduct(
      {
        product_name: 'Milk',
        serving_quantity: 240,
        serving_quantity_unit: 'ml',
        nutriments: { 'energy-kcal_serving': 122, proteins_serving: 8 },
      },
      '1234567890'
    );
    expect(r.serving_unit).toBe('ml');
    expect(r.serving_amount).toBe(240);
  });

  it('reports basis "none" when the product carries no nutrition data', () => {
    const r = shapeOffProduct({ product_name: 'Mystery Item', nutriments: {} }, '1234567890');
    expect(r.basis).toBe('none');
    expect(r.name).toBe('Mystery Item');
    expect(r.serving_amount).toBeNull();
    expect(Object.values(r.macros).every(v => v === null)).toBe(true);
  });

  it('survives a product with missing/garbage fields', () => {
    const r = shapeOffProduct({}, '1234567890');
    expect(r.name).toBe('');
    expect(r.brand_name).toBe('');
    expect(r.basis).toBe('none');
  });
});

describe('lookupBarcode', () => {
  it('returns shaped product data on a hit', async () => {
    const fetchImpl = mockFetchProduct(NUTELLA);
    const r = await lookupBarcode('3017620422003', { fetchImpl });
    expect(r.found).toBe(true);
    expect(r.barcode).toBe('3017620422003');
    expect(r.name).toBe('Nutella');
    // Only the mapped fields are requested, and OFF wants a User-Agent.
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v2/product/3017620422003.json?fields=');
    expect(opts.headers['User-Agent']).toContain('FLOPS');
  });

  it('retries a 12-digit UPC as a 13-digit EAN before giving up', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ status: 0 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 1, product: { product_name: 'US Product', nutriments: { 'energy-kcal_100g': 100 } } }) });
    const r = await lookupBarcode('012345678905', { fetchImpl });
    expect(r.name).toBe('US Product');
    expect(fetchImpl.mock.calls[1][0]).toContain('/0012345678905.json');
  });

  it('throws BarcodeNotFoundError when OFF has no such product', async () => {
    const fetchImpl = mockFetchProduct(null, { status: 404 });
    await expect(lookupBarcode('3017620422003', { fetchImpl })).rejects.toBeInstanceOf(BarcodeNotFoundError);
  });

  it('throws BarcodeNotFoundError for an unusable barcode without calling out', async () => {
    const fetchImpl = jest.fn();
    await expect(lookupBarcode('abc', { fetchImpl })).rejects.toBeInstanceOf(BarcodeNotFoundError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws BarcodeLookupError when the network fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(lookupBarcode('3017620422003', { fetchImpl })).rejects.toBeInstanceOf(BarcodeLookupError);
  });

  it('throws BarcodeLookupError on a server-side failure', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(lookupBarcode('3017620422003', { fetchImpl })).rejects.toBeInstanceOf(BarcodeLookupError);
  });
});

describe('shapeOffProduct — micronutrients', () => {
  it('converts Open Food Facts gram values into our units', () => {
    // Real Cheerios shape: OFF stores every one of these in grams.
    const r = shapeOffProduct(
      {
        product_name: 'Cheerios',
        serving_quantity: 37,
        nutriments: {
          'energy-kcal_serving': 140,
          sodium_serving: 0.16,
          calcium_serving: 0.1,
          iron_serving: 0.0045,
          'vitamin-a_serving': 0.00015,
          'vitamin-c_serving': 0.00599,
          fiber_serving: 1.99,
        },
      },
      '016000275270'
    );
    expect(r.micros).toEqual({
      sodium_mg: 160,
      calcium_mg: 100,
      iron_mg: 4.5,
      vitamin_a_mcg: 150,
      vitamin_c_mg: 5.99,
      fiber_g: 1.99,
    });
  });

  it('scales micros to the serving when macros were derived', () => {
    const r = shapeOffProduct(
      {
        product_name: 'Oats',
        serving_quantity: 50,
        nutriments: { 'energy-kcal_100g': 380, sodium_100g: 0.01, iron_100g: 0.004 },
      },
      '1234567890'
    );
    // Micros must follow the macros' basis or they'd describe a different portion.
    expect(r.basis).toBe('serving_derived');
    expect(r.micros).toEqual({ sodium_mg: 5, iron_mg: 2 });
  });

  it('omits absent and zero nutrients rather than storing zeros', () => {
    const r = shapeOffProduct(
      { product_name: 'Water', nutriments: { 'energy-kcal_100g': 0, sodium_100g: 0, calcium_100g: 0.01 } },
      '1234567890'
    );
    expect(r.micros).toEqual({ calcium_mg: 10 });
  });

  it('gives an empty micros object when there is no nutrition at all', () => {
    const r = shapeOffProduct({ product_name: 'Mystery', nutriments: {} }, '1234567890');
    expect(r.micros).toEqual({});
  });
});
