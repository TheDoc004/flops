import { test, expect } from '@playwright/test';
import { fileURLToPath, URL } from 'node:url';

// Matches server/scripts/seed-demo.js. Only ever exists in a demo DB.
const DEMO_EMAIL = 'demo@flops.example';
const API = 'http://localhost:3001';
const OUT_DIR = fileURLToPath(new URL('../../../.demo/screenshots/', import.meta.url));

const ROUTES = [
  ['today', '/'],
  ['recipes', '/recipes'],
  ['ingredients', '/ingredients'],
  ['meal-builder', '/meal-builder'],
  ['review', '/history'],
  ['gym-today', '/training'],
  ['gym-schedule', '/training/schedule'],
  ['gym-workouts', '/training/workouts'],
  ['gym-progress', '/training/progress'],
  ['plan-goals', '/plan/goals'],
  ['plan-report', '/plan/report'],
  ['plan-profile', '/plan/profile'],
];

let token;

test.beforeAll(async ({ request }) => {
  const otp = await request.post(`${API}/api/auth/request-otp`, { data: { email: DEMO_EMAIL } });
  expect(otp.ok(), 'request-otp (needs AUTH_DEV=1)').toBe(true);
  const { dev_code } = await otp.json();
  const verify = await request.post(`${API}/api/auth/verify-otp`, { data: { email: DEMO_EMAIL, code: dev_code } });
  expect(verify.ok()).toBe(true);
  ({ token } = await verify.json());
  // Refuse to photograph anything but the seeded demo account.
  const me = await request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await me.json()).user.email).toBe(DEMO_EMAIL);
});

for (const [name, path] of ROUTES) {
  test(`screenshot ${name} (${path})`, async ({ page }) => {
    await page.addInitScript(t => localStorage.setItem('flops_auth_token', t), token);
    await page.goto(path);
    await page.locator('main.app-main').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    // Let reveal animations and Recharts settle.
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT_DIR}${name}.png`, fullPage: true, animations: 'disabled' });
  });
}
