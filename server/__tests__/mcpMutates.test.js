const { createDb } = require('../db');
const { createUser } = require('./helpers');
const mutates = require('../mcp/mutates');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

describe('MCP nutrition mutates', () => {
  let db;
  let userA;
  let userB;

  beforeEach(() => {
    db = createDb(':memory:');
    userA = createUser(db, 'a@mutate.test').id;
    userB = createUser(db, 'b@mutate.test').id;
  });

  it('creates, updates, soft-deletes a recipe for the owner only', () => {
    const created = mutates.createRecipe(db, userA, {
      name: 'Oats',
      serving_size: '1 bowl',
      calories: 300,
      protein_g: 12,
      carbs_g: 50,
      fat_g: 6,
      ingredients: [{ name: 'oats', amount: '50g' }],
    });
    expect(created.error).toBeUndefined();
    expect(created.recipe.id).toBeTruthy();

    const other = mutates.updateRecipe(db, userB, {
      recipe_id: created.recipe.id,
      name: 'Hijack',
      serving_size: '1',
      calories: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
    });
    expect(other.error).toMatch(/not found/);

    const del = mutates.deleteRecipe(db, userA, { recipe_id: created.recipe.id });
    expect(del.error).toBeUndefined();
    const row = db.prepare('SELECT is_deleted FROM recipes WHERE id = ?').get(created.recipe.id);
    expect(row.is_deleted).toBe(1);
  });

  it('creates fish oil supplement with EPA/DHA and fills day micros when taken', () => {
    const created = mutates.createSupplement(db, userA, {
      name: 'Fish Oil',
      dose_text: '2 softgels',
      label_serving_qty: 2,
      label_serving_unit: 'softgel',
      dose_qty: 2,
      micros: { omega3_epa_mg: 360, omega3_dha_mg: 240 },
    });
    expect(created.error).toBeUndefined();
    expect(created.supplement.per_label_serving.micros).toEqual({
      omega3_epa_mg: 360,
      omega3_dha_mg: 240,
    });

    const marked = writes.updateSupplement(db, userA, {
      supplement_id: created.supplement.id,
      taken: true,
      taken_date: '2026-09-26',
      day_dose_qty: 2,
    });
    expect(marked.error).toBeUndefined();
    expect(marked.taken.day_dose_qty).toBe(2);

    const totals = reads.getMicronutrientTotals(db, userA, '2026-09-26', '2026-09-26');
    expect(totals.totals.omega3_epa_mg).toBe(360);
    expect(totals.totals.omega3_dha_mg).toBe(240);
  });

  it('hard-deletes foods and upserts goals/profile/weight scoped to user', () => {
    const food = writes.addFoodItem(db, userA, {
      name: 'Banana',
      calories_per_100g: 89,
      protein_g_per_100g: 1,
      carbs_g_per_100g: 23,
      fat_g_per_100g: 0,
      nutrition_source: 'database',
      weight_basis: 'raw',
    });
    const del = mutates.deleteFoodItem(db, userB, { label_ingredient_id: food.label_ingredient_id });
    expect(del.error).toMatch(/not found/);
    expect(mutates.deleteFoodItem(db, userA, { label_ingredient_id: food.label_ingredient_id }).error).toBeUndefined();

    const goals = mutates.upsertGoals(db, userA, {
      effective_start_date: '2026-09-01',
      goals: [{ weekday: 1, calories_min: 2000, calories_max: 2400 }],
    });
    expect(goals.error).toBeUndefined();
    expect(goals.after.goals.find((g) => g.weekday === 1).calories_min).toBe(2000);

    const prof = mutates.updateProfile(db, userA, { age: 33, macro_units: 'us' });
    expect(prof.error).toBeUndefined();
    expect(prof.after.age).toBe(33);

    const wt = mutates.upsertBodyWeight(db, userA, { date: '2026-09-26', weight_kg: 80 });
    expect(wt.after.weight_kg).toBe(80);
    expect(mutates.deleteBodyWeight(db, userB, { date: '2026-09-26' }).error).toMatch(/No body weight/);
    expect(mutates.deleteBodyWeight(db, userA, { date: '2026-09-26' }).error).toBeUndefined();
  });
});

describe('MCP gym mutates', () => {
  let db;
  let userA;
  let userB;

  beforeEach(() => {
    db = createDb(':memory:');
    userA = createUser(db, 'gym-a@mutate.test').id;
    userB = createUser(db, 'gym-b@mutate.test').id;
  });

  it('templates, schedule, session, sets stay user-scoped', () => {
    const ex = mutates.createGymExercise(db, userA, { name: 'Bench Press', primary_muscle: 'chest' });
    expect(ex.error).toBeUndefined();
    const tmpl = mutates.createGymTemplate(db, userA, { name: 'Push A' });
    expect(tmpl.error).toBeUndefined();
    const item = mutates.addTemplateExercise(db, userA, {
      template_id: tmpl.template.id,
      exercise_id: ex.exercise.id,
      target_sets: 3,
      target_reps: 8,
    });
    expect(item.error).toBeUndefined();

    expect(
      mutates.deleteGymTemplate(db, userB, { template_id: tmpl.template.id }).error
    ).toMatch(/not found/);

    const sched = mutates.upsertGymSchedule(db, userA, {
      days: [{ weekday: 1, enabled: true, template_id: tmpl.template.id, duration_min: 60 }],
    });
    expect(sched.error).toBeUndefined();

    const sess = mutates.createGymSession(db, userA, { date: '2026-09-26', template_id: tmpl.template.id });
    expect(sess.error).toBeUndefined();
    const set = mutates.addGymSet(db, userA, {
      session_id: sess.session.id,
      exercise_id: ex.exercise.id,
      reps: 5,
      weight: 135,
      is_1rm: true,
    });
    expect(set.error).toBeUndefined();
    const orm = db
      .prepare('SELECT tested FROM gym_one_rep_maxes WHERE user_id = ? AND exercise_id = ?')
      .get(userA, ex.exercise.id);
    expect(orm.tested).toBe(135);

    expect(mutates.addGymSet(db, userB, {
      session_id: sess.session.id,
      exercise_id: ex.exercise.id,
      reps: 1,
      weight: 1,
    }).error).toMatch(/not found/);
  });
});
