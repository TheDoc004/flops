/**
 * Runtime identity for "what's actually serving" checks.
 * Prefer build-info.json (written at deploy); fall back to Render env / git / boot time.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROCESS_STARTED_AT = new Date().toISOString();
const PROCESS_STARTED_MS = Date.now();

let cachedFile = undefined;

function readBuildInfoFile() {
  if (cachedFile !== undefined) return cachedFile;
  const filePath = path.join(__dirname, 'build-info.json');
  try {
    cachedFile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    cachedFile = null;
  }
  return cachedFile;
}

function resolveGitSha() {
  const file = readBuildInfoFile();
  if (file?.git_sha && /^[0-9a-f]{7,40}$/i.test(String(file.git_sha))) {
    return { git_sha: String(file.git_sha), git_sha_source: 'build-info' };
  }

  const envPairs = [
    ['RENDER_GIT_COMMIT', 'render'],
    ['GIT_COMMIT', 'env'],
    ['SOURCE_VERSION', 'env'],
    ['COMMIT_SHA', 'env'],
  ];
  for (const [key, source] of envPairs) {
    const v = String(process.env[key] || '').trim();
    if (/^[0-9a-f]{7,40}$/i.test(v)) return { git_sha: v, git_sha_source: source };
  }

  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{7,40}$/i.test(sha)) return { git_sha: sha, git_sha_source: 'git' };
  } catch {
    // ignore
  }
  return { git_sha: null, git_sha_source: null };
}

/**
 * Compact payload for /health (no MCP tool list).
 */
function getHealthInfo() {
  const { git_sha, git_sha_source } = resolveGitSha();
  const file = readBuildInfoFile();
  return {
    status: 'ok',
    git_sha,
    git_sha_source,
    built_at: file?.built_at || null,
    process_started_at: PROCESS_STARTED_AT,
    uptime_s: Math.floor((Date.now() - PROCESS_STARTED_MS) / 1000),
  };
}

/**
 * Full MCP get_server_info payload.
 * @param {{ tools: string[] }} opts
 */
function getServerInfo({ tools = [] } = {}) {
  const health = getHealthInfo();
  const file = readBuildInfoFile();
  const sorted = [...tools].sort();
  return {
    git_sha: health.git_sha,
    git_sha_source: health.git_sha_source,
    git_branch:
      file?.git_branch
      || (process.env.RENDER_GIT_BRANCH || '').trim()
      || null,
    /** Deploy/build clock when build-info.json was written (Render build). */
    built_at: health.built_at,
    /**
     * When this Node process booted. If built_at is new but process_started_at
     * is old, the deploy built but the old process is still serving.
     */
    process_started_at: health.process_started_at,
    uptime_s: health.uptime_s,
    tool_count: sorted.length,
    tools: sorted,
    service_name: (process.env.RENDER_SERVICE_NAME || '').trim() || null,
    node_env: process.env.NODE_ENV || null,
  };
}

/** Test helper: clear cached build-info.json parse. */
function _resetBuildInfoCacheForTests() {
  cachedFile = undefined;
}

module.exports = {
  PROCESS_STARTED_AT,
  getHealthInfo,
  getServerInfo,
  resolveGitSha,
  _resetBuildInfoCacheForTests,
};
