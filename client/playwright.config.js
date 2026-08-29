import { defineConfig, devices } from '@playwright/test';
import { cfg } from './e2e/helpers/config.js';

const useExternal = cfg.external;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: cfg.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.FLOPS_VERIFY_VIDEO === '1' ? 'on' : 'off',
    actionTimeout: 15_000,
  },
  expect: {
    timeout: 15_000,
  },
  projects: process.env.FLOPS_VERIFY_MOBILE_ONLY === '1'
    ? [{ name: 'chromium-mobile', use: { ...devices['Pixel 5'], viewport: cfg.viewports.mobile } }]
    : [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: cfg.viewports.desktop } }],
  webServer: useExternal
    ? undefined
    : [
        {
          command: 'npm run dev',
          cwd: '../server',
          port: 3001,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { AUTH_DEV: '1', NODE_ENV: 'development' },
        },
        {
          command: 'npm run dev',
          port: 5173,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
