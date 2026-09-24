const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

describe('MCP Phase 2 writes', () => {
  let db;
  let userId;
  let ingredientId;
  let recipeId;
  let supplementId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'writer@mcp.test').id;
    db.prepare(
      `INSERT INTO label_ingredients (
         user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g, fiber_g,
         source_type, tracking_type
       ) VALUES (?, 'Chicken Breast', '100 g', 100, 165, 31, 0, 3.6, 0, 'manual', 'weight')`
    ).run(userId);
    ingredientId = db.prepare('SELECT id FROM label_ingredients WHERE user_id = ?').get(userId).id;

    db.prepare(
      `INSERT INTO recipes (user_id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, ingredients, is_quick_food)
       VALUES (?, 'Rice Bowl', '1 bowl', 450, 12, 70, 10, 4, '[]', 0)`
    ).run(userId);
    recipeId = db.prepare('SELECT id FROM recipes WHERE user_id = ? AND name = ?').get(userId, 'Rice Bowl').id;

    db.prepare(
      `INSERT INTO supplements (user_id, name, dose_text, calories, protein_g, carbs_g, fat_g, counts_toward_macros,
         label_serving_qty, label_serving_unit, dose_qty, sort_order)
       VALUES (?, 'Creatine', '5 g', 0, 0, 0, 0, 0, 5, 'g', 5, 0)`
    ).run(userId);
    supplementId = db.prepare('SELECT id FROM supplements WHERE user_id = ?').get(userId).id;
  });

  it('propose_food_item returns similar matches and does not write yet', () => {
    const p = writes.proposeFoodItem(db, userId, {
      name: 'Chicken',
      calories_per_100g: 165,
      protein_g_per_100g: 31,
      carbs_g_per_100g: 0,
      fat_g_per_100g: 3.6,
      nutrition_source: 'label',
      weight_basis: 'raw',
    });
    expect(p.error).toBeUndefined();
    expect(p.confirmation_code).toMatch(/^F-/);
    expect(p.preview.similar_library_items.length).toBeGreaterThan(0);
    expect(p.preview.similar_library_items[0].name).toMatch(/Chicken/i);
    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM label_ingredients WHERE user_id = ? AND created_via = 'mcp'`
    ).get(userId).n;
    expect(count).toBe(0);
  });

  it('commit_proposal with wrong code fails; correct code writes source=mcp', () => {
    const p = writes.proposeMealEntry(db, userId, {
      date: '2026-09-20',
      weight_basis: 'cooked',
      name: 'Lunch',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 150,
          nutrition_source: 'database',
        },
      ],
    });
    expect(p.proposal_id).toBeTruthy();

    const bad = writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: 'M-0000',
      user_confirmation_text: 'yes do it',
    });
    expect(bad.error).toMatch(/confirmation_code/);

    const dayBefore = reads.getDay(db, userId, '2026-09-20');
    expect(dayBefore.meals).toHaveLength(0);

    const ok = writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: p.confirmation_code,
      user_confirmation_text: 'yes, log it',
    });
    expect(ok.committed).toBe(true);
    expect(ok.result_row_ids.log_entry_ids).toHaveLength(1);

    const day = reads.getDay(db, userId, '2026-09-20');
    expect(day.meals).toHaveLength(1);
    expect(day.meals[0].source).toBe('mcp');
    expect(day.meals[0].weight_basis).toBe('cooked');
    expect(Math.round(day.meal_totals.calories)).toBe(Math.round(165 * 1.5));

    const audit = db.prepare(
      'SELECT * FROM mcp_write_audit WHERE user_id = ?'
    ).get(userId);
    expect(audit.user_confirmation_text).toBe('yes, log it');
    expect(audit.confirmation_code).toBe(p.confirmation_code);
  });

  it('expired proposal cannot commit', () => {
    const p = writes.proposeMealEntry(db, userId, {
      date: '2026-09-21',
      weight_basis: 'raw',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 100,
          nutrition_source: 'database',
        },
      ],
    });
    db.prepare(
      `UPDATE mcp_proposals SET expires_at = ? WHERE id = ?`
    ).run('2020-01-01T00:00:00.000Z', p.proposal_id);

    const r = writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: p.confirmation_code,
      user_confirmation_text: 'approve',
    });
    expect(r.error).toMatch(/expired/i);
  });

  it('same operation_id is idempotent', () => {
    const args = {
      date: '2026-09-22',
      weight_basis: 'raw',
      operation_id: 'op-meal-1',
      items: [
        {
          recipe_id: recipeId,
          servings: 1,
          nutrition_source: 'database',
        },
      ],
    };
    const a = writes.proposeMealEntry(db, userId, args);
    const b = writes.proposeMealEntry(db, userId, args);
    expect(b.proposal_id).toBe(a.proposal_id);
    expect(b.idempotent).toBe(true);

    writes.commitProposal(db, userId, {
      proposal_id: a.proposal_id,
      confirmation_code: a.confirmation_code,
      user_confirmation_text: 'ok',
    });
    const again = writes.commitProposal(db, userId, {
      proposal_id: a.proposal_id,
      confirmation_code: a.confirmation_code,
      user_confirmation_text: 'ok again',
    });
    expect(again.idempotent).toBe(true);

    const meals = db
      .prepare(`SELECT COUNT(*) AS n FROM log_entries WHERE user_id = ? AND source = 'mcp'`)
      .get(userId).n;
    expect(meals).toBe(1);
  });

  it('uncommitted proposal does not appear in get_day / get_log_range', () => {
    writes.proposeMealEntry(db, userId, {
      date: '2026-09-23',
      weight_basis: 'raw',
      items: [
        {
          name: 'Oats',
          quantity_g: 40,
          calories_per_100g: 389,
          protein_g_per_100g: 17,
          carbs_g_per_100g: 66,
          fat_g_per_100g: 7,
          nutrition_source: 'estimate',
        },
      ],
    });
    expect(reads.getDay(db, userId, '2026-09-23').meals).toHaveLength(0);
    expect(reads.getDailySummaries(db, userId, '2026-09-23', '2026-09-23')).toHaveLength(0);
  });

  it('list_recent_mcp_writes and bulk delete only touch mcp rows', () => {
    const p = writes.proposeMealEntry(db, userId, {
      date: '2026-09-24',
      weight_basis: 'cooked',
      items: [
        {
          label_ingredient_id: ingredientId,
          quantity_g: 100,
          nutrition_source: 'database',
        },
      ],
    });
    writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: p.confirmation_code,
      user_confirmation_text: 'ship it',
    });

    // Manual (non-mcp) entry
    db.prepare(
      `INSERT INTO log_entries (
         user_id, recipe_id, date, servings, recipe_name, serving_size,
         recipe_calories, recipe_protein_g, recipe_carbs_g, recipe_fat_g, recipe_fiber_g,
         recipe_is_quick_food, source
       ) VALUES (?, ?, '2026-09-24', 1, 'Manual', '1', 100, 10, 10, 2, 0, 0, 'app')`
    ).run(userId, recipeId);

    const recent = writes.listRecentMcpWrites(db, userId, 7);
    expect(recent.meals.every(m => m.source === 'mcp')).toBe(true);
    expect(recent.meals).toHaveLength(1);

    const mcpId = recent.meals[0].id;
    const manualId = db
      .prepare(`SELECT id FROM log_entries WHERE user_id = ? AND source = 'app'`)
      .get(userId).id;

    const del = writes.bulkDeleteMcpLogEntries(db, userId, [mcpId, manualId]);
    expect(del.deleted).toBe(1);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM log_entries WHERE id = ?`).get(manualId).n
    ).toBe(1);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM log_entries WHERE id = ?`).get(mcpId).n
    ).toBe(0);
  });

  it('propose_supplement_correction commit updates dose fields', () => {
    const p = writes.proposeSupplementCorrection(db, userId, {
      supplement_id: supplementId,
      dose_qty: 10,
      dose_text: '10 g',
    });
    expect(p.preview.before.dose_qty).toBe(5);
    expect(p.preview.after.dose_qty).toBe(10);
    writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: p.confirmation_code,
      user_confirmation_text: 'fix creatine dose',
    });
    const row = db.prepare('SELECT dose_qty, dose_text FROM supplements WHERE id = ?').get(supplementId);
    expect(row.dose_qty).toBe(10);
    expect(row.dose_text).toBe('10 g');
  });

  it('discard_proposal prevents commit', () => {
    const p = writes.proposeFoodItem(db, userId, {
      name: 'Whey Isolate Unique',
      calories_per_100g: 370,
      protein_g_per_100g: 80,
      carbs_g_per_100g: 5,
      fat_g_per_100g: 2,
      nutrition_source: 'label',
      weight_basis: 'raw',
    });
    writes.discardProposal(db, userId, p.proposal_id);
    const r = writes.commitProposal(db, userId, {
      proposal_id: p.proposal_id,
      confirmation_code: p.confirmation_code,
      user_confirmation_text: 'yes',
    });
    expect(r.error).toMatch(/discarded/i);
  });
});
