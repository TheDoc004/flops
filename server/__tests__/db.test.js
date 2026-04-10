const { createDb } = require('../db');

describe('createDb', () => {
  it('creates both tables', () => {
    const db = createDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('recipes');
    expect(names).toContain('log_entries');
  });

  it('recipes table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    ]));
  });

  it('log_entries table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'recipe_id', 'date', 'servings', 'notes',
    ]));
  });
});
