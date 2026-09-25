const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const reads = require('./reads');
const writes = require('./writes');

const READ_ONLY =
  'Read-only FLOPS data tool. Does not write meals, change foods, or alter settings. '
  + 'Logging and edits use the separate write tools.';

const WRITE_NOW =
  'WRITE tool — commits immediately (no propose/commit handshake). '
  + 'After writing, show the user what changed. '
  + 'If nutrition_source is "estimate", say plainly that the numbers were inferred. '
  + 'Rows are permanently flagged source=mcp (visible in the app). '
  + 'Meal deletes soft-delete (is_deleted=1) and are undoable via revert_mcp_write(audit_id). '
  + 'weight_basis: item-level overrides meal-level; conflict with a library ingredient\'s '
  + 'stored weight_basis is refused (no raw↔cooked conversion).';

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
  weight_basis: z
    .enum(['raw', 'cooked'])
    .optional()
    .describe('Overrides meal weight_basis for this item. Must match library ingredient if set.'),
  micros_per_100g: z.record(z.string(), z.number()).optional(),
});

function wrapWrite(result) {
  if (result?.error) {
    if (result.code || result.matching) {
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }
    return reads.errorResult(result.error);
  }
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
        `${READ_ONLY} One calendar day: meals (each with id + ingredients including label_ingredient_id when present), `
        + 'meal totals, supplements taken, combined totals, goals for that weekday, vs-goal status, and body weight if logged.',
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
        `${READ_ONLY} Meal log over a date range (max 90 days). By default returns daily macro summaries; set include_entries true for per-meal detail with ids (keep ranges short).`,
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
    'search_ingredients',
    {
      title: 'Search ingredients',
      description:
        `${READ_ONLY} Search the ingredient library by name or brand substring. `
        + 'Returns label_ingredient_id, serving macros, derived per_100g when possible, '
        + 'weight_basis, nutrition_source, and whether micros exist. Prefer these IDs in log_meal '
        + 'instead of creating duplicate foods.',
      inputSchema: {
        query: z.string().optional().describe('Name or brand substring (case-insensitive)'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) =>
      reads.textResult({
        query: query || '',
        ingredients: reads.searchIngredients(db, userId, query, { limit }),
      })
  );

  server.registerTool(
    'list_supplements',
    {
      title: 'List supplements',
      description:
        `${READ_ONLY} Full supplement library (not just taken days): IDs, dose fields, `
        + 'per-label-serving macros/micros, active/archived (is_deleted). '
        + 'Use supplement_id with update_supplement.',
      inputSchema: {
        include_deleted: z
          .boolean()
          .optional()
          .describe('Include soft-deleted/archived supplements (default false)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_deleted }) =>
      reads.textResult({
        supplements: reads.listSupplements(db, userId, { include_deleted: !!include_deleted }),
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
        + 'or new per-100g food. Requires meal weight_basis; item weight_basis overrides it. '
        + 'If an item cites a library ingredient whose stored weight_basis disagrees, the write is refused. '
        + 'Requires per-item nutrition_source. Returns the entry, resolved_weight_basis per item, and day totals/vs_goals. '
        + 'Discover ingredient IDs with search_ingredients.',
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
        `${WRITE_NOW} Create an ingredient-library food immediately. `
        + 'If a library name is highly similar, the call is REFUSED unless allow_duplicate=true '
        + '(returns matching rows). Warnings may flag missing fiber/micros; they never block the write.',
      inputSchema: {
        name: z.string().min(1),
        brand_name: z.string().optional(),
        serving_size_text: z.string().optional(),
        grams_per_serving: z
          .number()
          .min(3)
          .optional()
          .describe('Label serving weight in grams (min 3). Omit to default 100g when creating from per-100g macros.'),
        calories_per_100g: z.number().nonnegative(),
        protein_g_per_100g: z.number().nonnegative(),
        carbs_g_per_100g: z.number().nonnegative(),
        fat_g_per_100g: z.number().nonnegative(),
        fiber_g_per_100g: z.number().nonnegative().optional(),
        nutrition_source: z.enum(['label', 'database', 'estimate']),
        weight_basis: z.enum(['raw', 'cooked']),
        micros_per_100g: z.record(z.string(), z.number()).optional(),
        allow_duplicate: z
          .boolean()
          .optional()
          .describe('Required true to create when a highly similar name already exists'),
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
        grams_per_serving: z
          .number()
          .min(3)
          .nullable()
          .optional()
          .describe('Label serving weight in grams (min 3), or null to clear a placeholder.'),
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
        `${WRITE_NOW} Change date/slot/name or replace items on a log entry (use id from get_day / get_log_range). `
        + 'Returns before/after plus day_before/day_after totals. '
        + 'Replacing items soft-deletes the old row and inserts a new log_entry_id (revert restores the old id).',
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
        `${WRITE_NOW} Soft-delete a log entry (is_deleted=1). Row stays for undo; day totals exclude it. `
        + 'Revert with revert_mcp_write(audit_id). Returns day_before/day_after.',
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
        `${WRITE_NOW} Update dose fields and/or per-label-serving macros/micros. `
        + 'dose_multiplier = dose_qty/label_serving_qty. '
        + 'Changing macros/micros recalculates historical day totals for days that took this supplement '
        + '(live scaling on read — meal logs are unchanged). Returns before/after; '
        + 'historical_totals_recalculate flags nutrition edits. Use list_supplements for IDs.',
      inputSchema: {
        supplement_id: z.number().int().positive(),
        dose_text: z.string().optional(),
        dose_qty: z.number().positive().optional(),
        label_serving_qty: z.number().positive().optional(),
        label_serving_unit: z.string().optional(),
        calories: z.number().nonnegative().optional().describe('Per label serving'),
        protein_g: z.number().nonnegative().optional().describe('Per label serving'),
        carbs_g: z.number().nonnegative().optional().describe('Per label serving'),
        fat_g: z.number().nonnegative().optional().describe('Per label serving'),
        micros: z
          .record(z.string(), z.number())
          .nullable()
          .optional()
          .describe('Per label serving micros object, or null to clear'),
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
    'revert_mcp_write',
    {
      title: 'Revert MCP write',
      description:
        `${WRITE_NOW} Undo a prior MCP write by audit_id from list_recent_mcp_writes. `
        + 'Creates are soft-removed; updates restore the before snapshot; soft-deleted meals are restored. '
        + 'Legacy hard deletes (if any predate soft-delete) return NOT_REVERTIBLE.',
      inputSchema: {
        audit_id: z.number().int().positive(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.revertMcpWrite(db, userId, args))
  );

  server.registerTool(
    'list_recent_mcp_writes',
    {
      title: 'List recent MCP writes',
      description:
        `${READ_ONLY} Meals, foods, and audit rows (with audit_id for revert_mcp_write) from MCP in the last N days.`,
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
