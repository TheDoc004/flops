#!/usr/bin/env node
/**
 * Write server/build-info.json at deploy/build time.
 * Render sets RENDER_GIT_COMMIT during build; locally we fall back to git.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

function resolveGitSha() {
  const fromEnv = (
    process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT
    || process.env.SOURCE_VERSION
    || process.env.COMMIT_SHA
    || ''
  ).trim();
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv;

  try {
    return execSync('git rev-parse HEAD', {
      cwd: path.join(root, '..'),
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const info = {
  git_sha: resolveGitSha(),
  built_at: new Date().toISOString(),
  git_branch: (process.env.RENDER_GIT_BRANCH || '').trim() || null,
};

const out = path.join(root, 'build-info.json');
fs.writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`);
console.log(`[build-info] wrote ${out} sha=${info.git_sha || 'unknown'}`);
