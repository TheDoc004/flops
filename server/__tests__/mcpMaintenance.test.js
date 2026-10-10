const { buildTestApp, createUser } = require('./helpers');
const writes = require('../mcp/writes');
const reads = require('../mcp/reads');

const LB_PER_KG = 2.20462;

function isoPlus(start, days) {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('estimate_maintenance + set_maintenance_calories', () => {
  let db;
  let userId;
  let foodId;

  beforeEach(() => {
    ({ db } = buildTestApp());
    userId = createUser(db, 'maint@mcp.test').id;
    foodId = db.prepare(
      `INSERT INTO label_ingredients (user_id, name, serving_size_text, grams_per_serving, calories, protein_g, carbs_g, fat_g)
       VALUES (?, 'Test food', '100 g', 100, 300, 10, 50, 5)`
    ).run(userId).lastInsertRowid;
  });

  /** n days ending `end`: 3000 kcal/day, weight rising 0.1 lb/day (0.7 lb/week). */
  function seed(end, n, { skipLogs = 0 } = {}) {
    const start = isoPlus(end, -(n - 1));
    for (let i = 0; i < n; i++) {
      const date = isoPlus(start, i);
      if (i >= skipLogs) {
        writes.logMeal(db, userId, {
          date, weight_basis: 'raw',
          items: [{ label_ingredient_id: foodId, quantity_g: 1000, nutrition_source: 'database' }],
        });
      }
      writes.logBodyWeight(db, userId, { date, weight: 150 + 0.1 * i, unit: 'lb' });
    }
  }

  it('brackets maintenance between the all-fat and mixed-tissue assumptions', () => {
    seed('2026-10-09', 28);
    db.prepare('INSERT INTO user_profile (user_id, maintenance_calories) VALUES (?, 2500) ON CONFLICT(user_id) DO UPDATE SET maintenance_calories = 2500').run(userId);
    const r = reads.estimateMaintenance(db, userId, { end: '2026-10-09' });
    expect(r.window).toMatchObject({ start: '2026-09-12', end: '2026-10-09', days: 28, days_with_food_log: 28, weigh_ins: 28 });
    expect(r.avg_intake_kcal).toBe(3000);
    expect(r.weight_trend_lb_per_week).toBeCloseTo(0.7, 2);
    // 3000 − 0.7×3500/7 = 2650 (all fat); 3000 − 0.7×2500/7 = 2750 (mixed)
    expect(r.if_change_was_all_fat_kcal).toBe(2650);
    expect(r.if_change_was_mixed_tissue_kcal).toBe(2750);
    expect(r.estimate_kcal).toBe(2700);
    expect(r.plausible_range_kcal).toEqual([2650, 2750]); // a perfect line has ~0 SE
    expect(r.profile_maintenance_kcal).toBe(2500);
    expect(r.difference_vs_profile_kcal).toBe(200);
    expect(r.warnings).toEqual([]);
  });

  it('warns when food logging is sparse and validates the window', () => {
    seed('2026-10-09', 28, { skipLogs: 10 });
    const r = reads.estimateMaintenance(db, userId, { end: '2026-10-09' });
    expect(r.window.days_with_food_log).toBe(18);
    expect(r.warnings.join(' ')).toMatch(/18\/28 days have food logged/);
    expect(reads.estimateMaintenance(db, userId, { days: 7 }).error).toMatch(/14–90/);
  });

  it('returns no estimate without data instead of a made-up number', () => {
    const r = reads.estimateMaintenance(db, userId, { end: '2026-10-09' });
    expect(r.estimate_kcal).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/Not enough/);
  });

  it('sets the profile value, reports the previous one, and reverts', () => {
    db.prepare('INSERT INTO user_profile (user_id, maintenance_calories) VALUES (?, 2500) ON CONFLICT(user_id) DO UPDATE SET maintenance_calories = 2500').run(userId);
    const r = writes.setMaintenanceCalories(db, userId, { maintenance_calories: 2798 });
    expect(r).toMatchObject({ maintenance_calories: 2798, previous: 2500 });
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2798);
    expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).error).toBeUndefined();
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2500);
  });

  it('creates the profile row if missing, rounds, and rejects out-of-range values', () => {
    expect(writes.setMaintenanceCalories(db, userId, { maintenance_calories: 2799.6 }).maintenance_calories).toBe(2800);
    expect(writes.setMaintenanceCalories(db, userId, { maintenance_calories: 600 }).code).toBe('OUT_OF_RANGE');
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2800);
  });

  it('refuses to revert over a newer edit from the app, and works inside write_batch', () => {
    const r = writes.setMaintenanceCalories(db, userId, { maintenance_calories: 2800 });
    db.prepare('UPDATE user_profile SET maintenance_calories = 2900 WHERE user_id = ?').run(userId);
    expect(writes.revertMcpWrite(db, userId, { audit_id: r.audit_id }).code).toBe('NOT_REVERTIBLE');
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2900);

    const b = writes.writeBatch(db, userId, {
      operations: [{ op: 'set_maintenance_calories', maintenance_calories: 2750 }],
    });
    expect(b.error).toBeUndefined();
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2750);
    writes.revertMcpWrite(db, userId, { audit_id: b.audit_id });
    expect(reads.getProfile(db, userId).maintenance_calories).toBe(2900);
  });
});
