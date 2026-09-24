const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const reads = require('./reads');
const writes = require('./writes');

const READ_ONLY =
  'Read-only FLOPS data tool. Does not write meals or change settings. Logging stays in the FLOPS app unless you use a separate write/propose tool.';

const WRITE_CONFIRM =
  'WRITE tool. Call commit_proposal only after the user has approved in their own message, '
  + 'and never in the same turn as the matching propose_* call. '
  + 'Proposals expire after 1 hour. Bad writes are flagged source=mcp and can be bulk-undone in the app.';

const mealItemSchema = z.object({
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
    'propose_meal_entry',
    {
      title: 'Propose meal entry',
      description:
        `${WRITE_CONFIRM} Build a pending meal log proposal (does not write yet). `
        + 'Items: existing label_ingredient_id + quantity_g, recipe_id + servings, or new food with per-100g macros. '
        + 'Requires weight_basis raw|cooked and per-item nutrition_source label|database|estimate.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        name: z.string().optional(),
        meal_slot: z.string().optional().describe('e.g. breakfast, lunch, dinner, snack'),
        time_min: z.number().int().min(0).max(1439).optional(),
        weight_basis: z.enum(['raw', 'cooked']).describe('Raw vs cooked weight for the meal'),
        items: z.array(mealItemSchema).min(1),
        operation_id: z.string().optional().describe('Client idempotency key'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.proposeMealEntry(db, userId, args))
  );

  server.registerTool(
    'propose_food_item',
    {
      title: 'Propose food item',
      description:
        `${WRITE_CONFIRM} Propose a new ingredient-library food (does not write yet). `
        + 'Returns similar existing names so duplicates can be caught before commit.',
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
    async (args) => wrapWrite(writes.proposeFoodItem(db, userId, args))
  );

  server.registerTool(
    'propose_supplement_correction',
    {
      title: 'Propose supplement dose correction',
      description:
        `${WRITE_CONFIRM} Propose fixing dose_text / dose_qty / label serving on an existing supplement. Preview includes before/after.`,
      inputSchema: {
        supplement_id: z.number().int().positive(),
        dose_text: z.string().optional(),
        dose_qty: z.number().positive().optional(),
        label_serving_qty: z.number().positive().optional(),
        label_serving_unit: z.string().optional(),
        operation_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.proposeSupplementCorrection(db, userId, args))
  );

  server.registerTool(
    'commit_proposal',
    {
      title: 'Commit proposal',
      description:
        `${WRITE_CONFIRM} Writes the real row for a pending proposal. `
        + 'Requires proposal_id, confirmation_code from the propose response, and user_confirmation_text '
        + '(the user\'s verbatim approval message). Never call in the same turn as propose_*.',
      inputSchema: {
        proposal_id: z.string().min(1),
        confirmation_code: z.string().min(1),
        user_confirmation_text: z
          .string()
          .min(1)
          .describe("User's verbatim approval text from chat"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => wrapWrite(writes.commitProposal(db, userId, args))
  );

  server.registerTool(
    'list_proposals',
    {
      title: 'List proposals',
      description: `${WRITE_CONFIRM} List recent pending/committed (and optionally expired) MCP proposals.`,
      inputSchema: {
        include_expired: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_expired }) =>
      wrapWrite(writes.listProposals(db, userId, { include_expired }))
  );

  server.registerTool(
    'discard_proposal',
    {
      title: 'Discard proposal',
      description: `${WRITE_CONFIRM} Discard a pending proposal without writing.`,
      inputSchema: {
        proposal_id: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ proposal_id }) => wrapWrite(writes.discardProposal(db, userId, proposal_id))
  );

  server.registerTool(
    'list_recent_mcp_writes',
    {
      title: 'List recent MCP writes',
      description:
        `${READ_ONLY} Meals, foods, and audit rows written via MCP in the last N days (default 7).`,
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
