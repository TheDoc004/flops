const { buildTestApp, createUser } = require('./helpers');
const reads = require('../mcp/reads');

/**
 * search_ingredients ranks by match quality first, use_count second. Searching
 * "apple" used to return four pineapple blends (higher use_count) and miss the
 * Pink Lady apple entirely.
 */
describe('search_ingredients ranking', () => {
  let db;
  let userId;

  const add = (name, useCount, brand = null) =>
    db.prepare(
      `INSERT INTO label_ingredients (user_id, name, brand_name, serving_size_text, grams_per_serving,
         calories, protein_g, carbs_g, fat_g, use_count)
       VALUES (?, ?, ?, '100 g', 100, 50, 1, 10, 0, ?)`
    ).run(userId, name, brand, useCount);

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'search@mcp.test').id;
    add('Frozen papaya, pineapple, banana, and mango', 40, 'kroger');
    add('frozen strawberry, mango, pineapple', 30, 'target');
    add('Frozen Strawberry, Pineapple, Mango, Peach Mix', 20, 'kroger');
    add('Peach/strawberry/pineapple/mango blend', 10);
    add('Cosmic Crisp Apple', 5);
    add('Pink Lady Apple', 1);
    add('Frozen blueberries', 3);
    add('apple', 0);
  });

  const names = (q, limit) => reads.searchIngredients(db, userId, q, { limit }).map(r => r.name);

  it('puts whole-word matches above substrings, whatever the use_count', () => {
    expect(names('apple', 3)).toEqual(['apple', 'Cosmic Crisp Apple', 'Pink Lady Apple']);
    // Substring matches still come back, after them.
    expect(names('apple')).toHaveLength(7);
    expect(names('apple')[3]).toMatch(/pineapple/i);
  });

  it('ranks a word prefix above a mid-word substring', () => {
    add('Pineapple chunks', 99);
    expect(names('pine')[0]).toBe('Pineapple chunks');
    expect(names('blueberr')).toEqual(['Frozen blueberries']);
  });

  it('keeps use_count order within a tier', () => {
    expect(names('mango')).toEqual([
      'Frozen papaya, pineapple, banana, and mango',
      'frozen strawberry, mango, pineapple',
      'Frozen Strawberry, Pineapple, Mango, Peach Mix',
      'Peach/strawberry/pineapple/mango blend',
    ]);
  });

  it('matches the brand as a whole word too', () => {
    expect(names('target')).toEqual(['frozen strawberry, mango, pineapple']);
  });

  it('treats regex characters in the query literally', () => {
    add('Rice (cooked)', 0);
    expect(names('(cooked)')).toEqual(['Rice (cooked)']);
    expect(names('.*')).toEqual([]);
  });
});
