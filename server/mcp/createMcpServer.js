const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const reads = require('./reads');
const writes = require('./writes');

const READ_ONLY =
  'Read-only FLOPS data tool. Does not write meals or change settings.';

const WRITE_NOW =
  'WRITE tool — commits immediately. Show the user what you wrote afterward. '
  + 'Rows are flagged source=mcp and appear in list_recent_mcp_writes / the Today undo banner. '
  + 'If nutrition_source is estimate, say so plainly. Deletes are permanent and not revertible.';

const mealItemSchema = z.object({
  ref: z.string().optional().describe('Local batch ref from a prior add_food_item in write_batch'),
  label_ingredient_id: z.number().int().positive().optional(),
  recipe_id: z.number().int().positive().optional(),
  name: z.string().optional(),
  quantity_g: z.number().positive().optional(),
  servings: z.number().positive().optional(),
  calories_per_100g: z.number().nonnegative().optional(),
  protein_g_per_100g: z.number().nonnegative().optional(),
  carbs_g_per_100g: z.number().nonnegative().optional(),
  fat_g_per_100g: z.number().nonnegative().optional(),
  fiber_g_per_100g: z.number().nonnegative().optional(),
  nutrition_source: z.enum(['label', 'database', 'estimate']),
  weight_basis: z.enum(['raw', 'cooked']).optional(),
  micros_per_100g: z.record(z.string(), z.number()).optional(),
});

function wrapWrite(result) {
  if (result?.error) return reads.errorResult(result.error);
  return reads.textResult(result);
}

function createFlopsMcpServer(db, userId) {
  const server = new McpServer({
    name: 'flops',
    version: '1.0.0',
  });

  server.registerTool(
    'get_day',
    {
      title: 'Get day summary',
      description:
        `${READ_ONLY} One calendar day: meals (macros + micros), meal totals, supplements taken, combined totals, goals for that weekday, vs-goal status, and body weight if logged.`,
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD (defaults to today, server local date)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => reads.textResult(reads.getDay(db, userId, date))
  );

  server.registerTool(
    'get_log_range',
    {
      title: 'Get log range',
      description:
        `${READ_ONLY} Meal log over a date range (max 90 days). By default returns daily macro summaries; set include_entries true for per-meal detail (keep ranges short).`,
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
        include_entries: z
          .boolean()
          .optional()
          .describe('If true, include every meal entry (default false)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, end, include_entries }) => {
      const range = reads.normalizeRange(start, end, { maxDays: 90 });
      if (range.error) return reads.errorResult(range.error);
      const days = reads.getDailySummaries(db, userId, range.start, range.end);
      const payload = { start: range.start, end: range.end, days };
      if (include_entries) {
        payload.entries = reads.getLogEntries(db, userId, {
          start: range.start,
          end: range.end,
        });
      }
      return reads.textResult(payload);
    }
  );

  server.registerTool(
    'get_goals',
    {
      title: 'Get macro goals',
      description: `${READ_ONLY} Versioned weekly macro min/max goals resolved for a date, plus that weekday's row.`,
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD (defaults to today)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => reads.textResult(reads.getGoalsForDate(db, userId, date))
  );

  server.registerTool(
    'get_body_weights',
    {
      title: 'Get body weights',
      description: `${READ_ONLY} Body weight history. Optional start/end (max 365 days when both set).`,
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, end }) => {
      if ((start && !end) || (!start && end)) {
        return reads.errorResult('Provide both start and end, or neither');
      }
      if (start && end) {
        const range = reads.normalizeRange(start, end, { maxDays: 365 });
        if (range.error) return reads.errorResult(range.error);
        return reads.textResult({
          start: range.start,
          end: range.end,
          weights: reads.getBodyWeights(db, userId, range.start, range.end),
        });
      }
      return reads.textResult({ weights: reads.getBodyWeights(db, userId) });
    }
  );

  server.registerTool(
    'get_intake_weight_trend',
    {
      title: 'Get intake vs weight trend',
      description:
        `${READ_ONLY} Combines meal intake and body weights over a window (max 90 days). `
        + 'Averages macros over logged days only (reports coverage). Weight slope uses '
        + 'least-squares vs date with standard error + confidence. Optional split_at for '
        + 'baseline vs current + delta. estimated_maintenance_kcal is an inference '
        + '(avg intake − slope×energy_density/7), not a measurement.',
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
        split_at: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            'Optional YYYY-MM-DD: baseline is start→split_at exclusive; current is split_at→end inclusive'
          ),
        energy_density_cal_per_lb: z
          .number()
          .positive()
          .optional()
          .describe('kcal per lb of tissue for maintenance inference (default 3500)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, end, split_at, energy_density_cal_per_lb }) => {
      const result = reads.getIntakeWeightTrend(db, userId, {
        start,
        end,
        split_at,
        energy_density_cal_per_lb,
      });
      if (result.error) return reads.errorResult(result.error);
      return reads.textResult(result);
    }
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Get profile',
      description: `${READ_ONLY} User profile: height, weight, units, activity prefs (no auth secrets).`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => reads.textResult(reads.getProfile(db, userId))
  );

  server.registerTool(
    'get_supplements_range',
    {
      title: 'Get supplements range',
      description:
        `${READ_ONLY} Taken supplements over a date range with dose-scaled macros/micros (max 90 days).`,
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, end }) => {
      const range = reads.normalizeRange(start, end, { maxDays: 90 });
      if (range.error) return reads.errorResult(range.error);
      return reads.textResult(
        reads.getSupplementsRange(db, userId, range.start, range.end)
      );
    }
  );

  server.registerTool(
    'get_micronutrient_totals',
    {
      title: 'Get micronutrient totals',
      description:
        `${READ_ONLY} Sum micronutrients over a range from meal micros_json (scaled by servings) plus optional taken supplements (max 90 days).`,
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        include_supplements: z
          .boolean()
          .optional()
          .describe('Include taken supplement micros (default true)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, end, include_supplements }) => {
      const range = reads.normalizeRange(start, end, { maxDays: 90 });
      if (range.error) return reads.errorResult(range.error);
      return reads.textResult(
        reads.getMicronutrientTotals(db, userId, range.start, range.end, {
          includeSupplements: include_supplements !== false,
        })
      );
    }
  );

  server.registerTool(
    'search_recipes',
    {
      title: 'Search recipes',
      description: `${READ_ONLY} Search the recipe library by name substring (excludes quick-food backing recipes).`,
      inputSchema: {
        query: z.string().optional().describe('Name substring (empty = first page of library)'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) =>
      reads.textResult({
        recipes: reads.searchRecipes(db, userId, query, { limit }),
      })
  );

  server.registerTool(
    'get_gym_today',
    {
      title: 'Get gym day',
      description:
        `${READ_ONLY} Gym schedule + session/sets for a date (when workouts are logged). Progressive-overload analysis is up to the agent.`,
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD (defaults to today)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => reads.textResult(reads.getGymToday(db, userId, date))
  );

  server.registerTool(
    'get_gym_progress',
    {
      title: 'Get gym progress',
      description:
        `${READ_ONLY} Working-set history and daily aggregates for one exercise (by id or name). Optional window W|2W|M|3M|6M|ALL.`,
      inputSchema: {
        exercise_id: z.number().int().positive().optional(),
        exercise_name: z.string().optional().describe('Fuzzy name match if id omitted'),
        window: z.enum(['W', '2W', 'M', '3M', '6M', 'ALL']).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        last_sessions: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const result = reads.getGymProgress(db, userId, args);
      if (result.error) return reads.errorResult(result.error);
      return reads.textResult(result);
    }
  );

  server.registerTool(
    'log_meal',
    {
      title: 'Log meal',
      description:
        `${WRITE_NOW} Log a meal immediately. Items: label_ingredient_id+quantity_g, recipe_id+servings, `
        + 'or new per-100g food. Requires weight_basis and per-item nutrition_source. '
        + 'Returns the created entry plus the day\'s updated totals and vs_goals.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        name: z.string().optional(),
        meal_slot: z.string().optional(),
        time_min: z.number().int().min(0).max(1439).optional(),
        weight_basis: z.enum(['raw', 'cooked']),
        items: z.array(mealItemSchema).min(1),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.logMeal(db, userId, args))
  );

  server.registerTool(
    'add_food_item',
    {
      title: 'Add food item',
      description:
        `${WRITE_NOW} Create an ingredient-library food immediately. Returns similar names for awareness.`,
      inputSchema: {
        name: z.string().min(1),
        brand_name: z.string().optional(),
        serving_size_text: z.string().optional(),
        grams_per_serving: z.number().positive().optional(),
        calories_per_100g: z.number().nonnegative(),
        protein_g_per_100g: z.number().nonnegative(),
        carbs_g_per_100g: z.number().nonnegative(),
        fat_g_per_100g: z.number().nonnegative(),
        fiber_g_per_100g: z.number().nonnegative().optional(),
        nutrition_source: z.enum(['label', 'database', 'estimate']),
        weight_basis: z.enum(['raw', 'cooked']),
        micros_per_100g: z.record(z.string(), z.number()).optional(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.addFoodItem(db, userId, args))
  );

  server.registerTool(
    'update_food_item',
    {
      title: 'Update food item',
      description: `${WRITE_NOW} Patch an existing label ingredient. Returns before/after.`,
      inputSchema: {
        label_ingredient_id: z.number().int().positive(),
        name: z.string().optional(),
        brand_name: z.string().nullable().optional(),
        serving_size_text: z.string().optional(),
        grams_per_serving: z.number().positive().optional(),
        calories: z.number().nonnegative().optional(),
        protein_g: z.number().nonnegative().optional(),
        carbs_g: z.number().nonnegative().optional(),
        fat_g: z.number().nonnegative().optional(),
        fiber_g: z.number().nonnegative().nullable().optional(),
        nutrition_source: z.enum(['label', 'database', 'estimate']).optional(),
        weight_basis: z.enum(['raw', 'cooked']).optional(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.updateFoodItem(db, userId, args))
  );

  server.registerTool(
    'update_meal_entry',
    {
      title: 'Update meal entry',
      description:
        `${WRITE_NOW} Change date/slot/name or replace items on a log entry. Returns before/after. `
        + 'Replacing items may assign a new log_entry_id.',
      inputSchema: {
        log_entry_id: z.number().int().positive(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        name: z.string().optional(),
        meal_slot: z.string().optional(),
        time_min: z.number().int().min(0).max(1439).optional(),
        weight_basis: z.enum(['raw', 'cooked']).optional(),
        items: z.array(mealItemSchema).optional(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.updateMealEntry(db, userId, args))
  );

  server.registerTool(
    'delete_meal_entry',
    {
      title: 'Delete meal entry',
      description:
        `${WRITE_NOW} HARD delete a log entry. Permanent and not revertible — the row is gone.`,
      inputSchema: {
        log_entry_id: z.number().int().positive(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.deleteMealEntry(db, userId, args))
  );

  server.registerTool(
    'update_supplement',
    {
      title: 'Update supplement',
      description:
        `${WRITE_NOW} Update dose_text / dose_qty / label serving (dose_multiplier = dose_qty/label_serving_qty). `
        + 'Optional taken + taken_date for the checklist. Returns before/after including dose_multiplier.',
      inputSchema: {
        supplement_id: z.number().int().positive(),
        dose_text: z.string().optional(),
        dose_qty: z.number().positive().optional(),
        label_serving_qty: z.number().positive().optional(),
        label_serving_unit: z.string().optional(),
        taken: z.boolean().optional(),
        taken_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.updateSupplement(db, userId, args))
  );

  server.registerTool(
    'write_batch',
    {
      title: 'Write batch',
      description:
        `${WRITE_NOW} Run multiple write ops in one all-or-nothing transaction. `
        + 'add_food_item may set ref; later log_meal items can use that ref. Any failure rolls back all.',
      inputSchema: {
        operations: z.array(z.record(z.string(), z.any())).min(1),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.writeBatch(db, userId, args))
  );

  server.registerTool(
    'list_recent_mcp_writes',
    {
      title: 'List recent MCP writes',
      description:
        `${READ_ONLY} Meals, foods, and audit rows (with audit_id) written via MCP in the last N days.`,
      inputSchema: {
        days: z.number().int().min(1).max(90).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ days }) => wrapWrite(writes.listRecentMcpWrites(db, userId, days))
  );

  return server;
}

module.exports = { createFlopsMcpServer };
