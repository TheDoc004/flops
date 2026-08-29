#!/usr/bin/env node
/**
 * One-shot layout editor verification.
 * Usage: node scripts/verify-layout-editor.mjs [--headed] [--production]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const production = args.includes('--production');

const env = { ...process.env };

if (production) {
  env.FLOPS_BASE_URL = env.FLOPS_BASE_URL || 'https://www.useflops.com';
  env.FLOPS_API_BASE = env.FLOPS_API_BASE || 'https://www.useflops.com';
  env.FLOPS_E2E_EXTERNAL = '1';
  if (!env.FLOPS_E2E_TOKEN) {
    console.error('\n❌ Production verify requires FLOPS_E2E_TOKEN.');
    console.error('   DevTools → Application → Local Storage → flops_auth_token');
    console.error('   export FLOPS_E2E_TOKEN="..." && npm run verify:layout-editor -- --production\n');
    process.exit(1);
  }
}

function run(cmd, cmdArgs, extraEnv = {}) {
  console.log(`\n▶ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: clientRoot,
    stdio: 'inherit',
    env: { ...env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('═══ FLOPS layout editor verification ═══');
console.log(`Target: ${env.FLOPS_BASE_URL || 'http://localhost:5173'}`);

run('npm', ['test', '--', 'src/features/dashboard/dashboardLayout.test.js']);

const pwArgs = ['playwright', 'test', 'e2e/layout-editor.verify.spec.js'];
if (headed) pwArgs.push('--headed');

run('npx', [...pwArgs, '--project=chromium-desktop'], { FLOPS_VERIFY_DESKTOP_ONLY: '1' });
run('npx', [...pwArgs, '--project=chromium-mobile'], { FLOPS_VERIFY_MOBILE_ONLY: '1' });

const reportDir = path.join(clientRoot, 'e2e/reports');
const reports = ['layout-editor-report-chromium-desktop.json', 'layout-editor-report-chromium-mobile.json'];
let allPass = true;

console.log('\n── Summary ──');
for (const file of reports) {
  const p = path.join(reportDir, file);
  if (!fs.existsSync(p)) {
    console.log(`⚠ missing ${file}`);
    allPass = false;
    continue;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mark = data.pass ? '✅' : '❌';
  console.log(`${mark} ${file} → ${data.checks.filter(c => !c.ok).length} failed of ${data.checks.length}`);
  if (!data.pass) allPass = false;
}

console.log(allPass ? '\n✅ ALL CHECKS PASSED' : '\n❌ SOME CHECKS FAILED — see e2e/reports/');
process.exit(allPass ? 0 : 1);
