import { defineConfig } from '@playwright/test';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

/**
 * Demo screenshots: seeds a fresh demo DB, boots its own API + Vite against it,
 * signs in as the demo user and captures every main route at 390px.
 *
 *   cd client && npm run demo:screenshots   → ../.demo/screenshots/*.png
 *
 * Never reuses a running server: an already-running dev API would be pointed at
 * a real database, so a busy port fails the run instead.
 */
const demoDb = fileURLToPath(new URL('../.demo/demo.db', import.meta.url));

// Blank so a local server/.env can't make the demo send mail or spend AI calls.
const offline = { RESEND_API_KEY: '', SMTP_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' };

export default defineConfig({
  testDir: './e2e/demo',
  testMatch: '**/*.demo.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: '../.demo/test-results',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    // e.g. FLOPS_PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's download.
    ...(process.env.FLOPS_PW_CHANNEL ? { channel: process.env.FLOPS_PW_CHANNEL } : {}),
  },
  webServer: [
    {
      command: 'node scripts/seed-demo.js && node index.js',
      cwd: '../server',
      port: 3001,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...offline, DEMO_DB_PATH: demoDb, DB_PATH: demoDb, AUTH_DEV: '1', NODE_ENV: 'development' },
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
