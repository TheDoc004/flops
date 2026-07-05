const { createDb } = require('../db');

describe('createDb', () => {
  it('creates both tables', () => {
    const db = createDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('recipes');
    expect(names).toContain('log_entries');
    expect(names).toContain('day_goals');
    expect(names).toContain('day_goal_versions');
    expect(names).toContain('user_profile');
    expect(names).toContain('body_weights');
  });

  it('recipes table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'ingredients',
      'recipe_kind', 'remaining_uses', 'max_uses', 'is_archived', 'meal_builder_meta',
      'is_quick_food',
      'is_deleted',
      'created_at',
    ]));
  });

  it('creates label_ingredients table', () => {
    const db = createDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('label_ingredients');
  });

  it('label_ingredients includes memory columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(label_ingredients)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['base_label', 'brand_name', 'source_type', 'use_count', 'last_used_at']));
  });

  it('log_entries table has all required columns', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(log_entries)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'recipe_id', 'date', 'time_min', 'servings', 'notes',
      'recipe_name', 'serving_size',
      'recipe_calories', 'recipe_protein_g', 'recipe_carbs_g', 'recipe_fat_g', 'recipe_fiber_g',
      'recipe_is_quick_food',
      'slot_selections_json',
    ]));
  });

  it('user_profile includes units, dashboard prefs, and training prefs', () => {
    const db = createDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(user_profile)').all().map(c => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'macro_units',
        'body_units',
        'dash_weight_chart_enabled',
        'dash_weight_days',
        'dash_training_fuel_enabled',
        'digestion_pref',
        'training_goal',
      ])
    );
  });

  it('includes training tables', () => {
    const db = createDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'training_schedule',
      'training_overrides',
      'training_saved_recipes',
      'training_feedback',
      'daily_training_context',
    ]));
  });
});
