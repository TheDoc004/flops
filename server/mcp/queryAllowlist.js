/**
 * Allowlists for MCP read-only SQL (query + describe_schema).
 */

/** Notebook tables filtered to MCP_USER_ID via TEMP VIEW shadows. */
const USER_SCOPED_TABLES = [
  'log_entries',
  'recipes',
  'label_ingredients',
  'supplements',
  'supplement_log',
  'day_goals',
  'day_goal_versions',
  'user_profile',
  'body_weights',
  'gym_exercises',
  'gym_templates',
  'gym_template_exercises',
  'gym_schedule',
  'gym_sessions',
  'gym_sets',
  'gym_one_rep_maxes',
  'mcp_write_audit',
  'day_prep_items',
  'prepped_batches',
  'workout_presets',
  'workout_preset_exercises',
  'workout_day_selections',
  'exercise_logs',
  'training_schedule',
  'training_overrides',
  'training_feedback',
  'daily_training_context',
  'training_saved_recipes',
  'ai_usage',
];

/** Coach tables scoped by coach_user_id OR client_user_id. */
const COACH_SCOPED_TABLES = ['coach_day_suggestions', 'coach_links'];

/** Shared catalogs (no user filter). */
const GLOBAL_READ_TABLES = ['exercise_library'];

/** Auth/secret tables — empty shadow; never documented by describe_schema. */
const BLOCKED_TABLES = [
  'users',
  'sessions',
  'email_otps',
  'organizations',
  'org_memberships',
];

const ALLOWLISTED_TABLES = [
  ...USER_SCOPED_TABLES,
  ...COACH_SCOPED_TABLES,
  ...GLOBAL_READ_TABLES,
];

const MAX_ROWS = 1000;
const QUERY_TIMEOUT_MS = 5000;

module.exports = {
  USER_SCOPED_TABLES,
  COACH_SCOPED_TABLES,
  GLOBAL_READ_TABLES,
  BLOCKED_TABLES,
  ALLOWLISTED_TABLES,
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
};
