/**
 * CST-based SQL validation for MCP query (SELECT/WITH only, single statement).
 */
const { parse } = require('sql-parser-cst');

const FORBIDDEN_SCHEMA_OBJECTS = new Set([
  'sqlite_master',
  'sqlite_schema',
  'sqlite_temp_master',
  'sqlite_temp_schema',
]);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'range') continue;
    walk(node[key], visit);
  }
}

/**
 * Validate SQL. Returns { sql } or { error }.
 * @param {string} rawSql
 * @param {{ skipParse?: boolean }} [opts] — test-only: skip CST check (RO driver still applies)
 */
function validateSelectSql(rawSql, { skipParse = false } = {}) {
  if (rawSql == null || typeof rawSql !== 'string') {
    return { error: 'sql must be a string' };
  }
  const trimmed = rawSql.trim();
  if (!trimmed) return { error: 'Empty SQL' };
  if (trimmed.length > 20000) return { error: 'SQL exceeds 20000 characters' };

  if (skipParse) {
    return { sql: trimmed.replace(/;+\s*$/g, '') };
  }

  let cst;
  try {
    cst = parse(trimmed, {
      dialect: 'sqlite',
      includeComments: true,
      includeNewlines: true,
      includeSpaces: true,
    });
  } catch (err) {
    return { error: `SQL parse error: ${err.message.split('\n')[0]}` };
  }

  const statements = (cst.statements || []).filter((s) => s && s.type && s.type !== 'empty');
  if (!statements.length) return { error: 'Empty SQL' };
  if (statements.length > 1) {
    return { error: 'Multiple statements are not allowed' };
  }

  const stmt = statements[0];
  if (stmt.type !== 'select_stmt') {
    return {
      error: `Only SELECT or WITH … SELECT is allowed (got ${stmt.type})`,
    };
  }

  let schemaError = null;
  walk(stmt, (node) => {
    if (schemaError) return;
    if (node.type === 'member_expr') {
      const obj = String(node.object?.name || '').toLowerCase();
      if (obj === 'main' || obj === 'temp') {
        schemaError = 'Schema-qualified table names (main./temp.) are not allowed';
      }
      if (FORBIDDEN_SCHEMA_OBJECTS.has(obj)) {
        schemaError = 'Querying sqlite system catalogs is not allowed';
      }
    }
    if (node.type === 'identifier') {
      const name = String(node.name || '').toLowerCase();
      if (FORBIDDEN_SCHEMA_OBJECTS.has(name)) {
        schemaError = 'Querying sqlite system catalogs is not allowed';
      }
    }
  });
  if (schemaError) return { error: schemaError };

  return { sql: trimmed.replace(/;+\s*$/g, '') };
}

module.exports = {
  validateSelectSql,
};
