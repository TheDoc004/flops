import { test, expect } from '@playwright/test';
import { openAuthed } from './helpers/auth.js';
import { cfg, isProductionTarget } from './helpers/config.js';

const MOBILE = { width: 390, height: 844 };

const PAGES = [
  { path: '/', name: 'Today' },
  { path: '/recipes', name: 'Recipes' },
  { path: '/ingredients', name: 'Ingredients' },
  { path: '/history', name: 'History' },
  { path: '/plan/profile', name: 'Profile' },
  { path: '/training', name: 'Training' },
];

test.describe('Mobile smoke (390px)', () => {
  test.use({ viewport: MOBILE });

  for (const { path, name } of PAGES) {
    test(`${name} has no horizontal overflow`, async ({ page, request }) => {
      await openAuthed(page, request, path);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 4;
      });
      expect(overflow, `${name} should not scroll horizontally`).toBe(false);
    });
  }

  test('profile settings stack in one column', async ({ page, request }) => {
    await openAuthed(page, request, '/plan/profile');

    const grid = page.locator('.settings-grid');
    await expect(grid).toBeVisible();

    const cols = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(cols.split(' ').length).toBe(1);
  });

  test('download my data saves a JSON file of the signed-in user', async ({ page, request }) => {
    await openAuthed(page, request, '/plan/profile');

    const trigger = page.getByRole('button', { name: 'Download', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const box = await trigger.boundingBox();
    expect(box.height, 'touch target').toBeGreaterThanOrEqual(44);

    const download = page.waitForEvent('download');
    await trigger.click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^flops-export-\d{4}-\d{2}-\d{2}\.json$/);
    const fs = await import('node:fs/promises');
    const body = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
    expect(body.format).toBe('flops-export');
    expect(body.account.email).toMatch(/^e2e-/);
  });

  test('delete my account: two steps, 44px targets, then the session is gone', async ({ page, request }) => {
    // Never against a deployed server, and never the shared e2e user: a throwaway local account.
    test.skip(isProductionTarget() || !!cfg.authToken, 'local AUTH_DEV server only');
    const email = `e2e-delete-${Date.now()}@example.com`;
    const otp = await (await request.post(`${cfg.apiBase}/api/auth/request-otp`, { data: { email } })).json();
    const { token } = await (await request.post(`${cfg.apiBase}/api/auth/verify-otp`, {
      data: { email, code: String(otp.dev_code) },
    })).json();
    await request.patch(`${cfg.apiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { onboarding_completed: true },
    });
    await page.addInitScript((t) => {
      if (!sessionStorage.getItem('e2e-seeded')) {
        localStorage.setItem('flops_auth_token', t);
        sessionStorage.setItem('e2e-seeded', '1');
      }
    }, token);
    await page.goto('/plan/profile');
    await page.locator('main.app-main').waitFor({ state: 'visible', timeout: 30_000 });

    const trigger = page.getByRole('button', { name: 'Delete…' });
    await trigger.scrollIntoViewIfNeeded();
    expect((await trigger.boundingBox()).height, 'touch target').toBeGreaterThanOrEqual(44);
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Delete my account' });
    await expect(dialog.getByRole('button', { name: 'Download your data first' })).toBeVisible();
    // The dialog enters at scale(0.97); measure once it has settled.
    await dialog.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    const sendCode = dialog.getByRole('button', { name: 'Email me a code' });
    for (const b of [sendCode, dialog.getByRole('button', { name: 'Keep my account' })]) {
      expect((await b.boundingBox()).height, 'touch target').toBeGreaterThanOrEqual(44);
    }
    const codeRes = page.waitForResponse(r => r.url().includes('/api/me/delete-request'));
    await sendCode.click();
    const { dev_code: code } = await (await codeRes).json();

    await dialog.getByLabel('Code').fill(String(code));
    const confirm = dialog.getByRole('button', { name: 'Delete my account' });
    expect((await confirm.boundingBox()).height, 'touch target').toBeGreaterThanOrEqual(44);
    const deleted = page.waitForResponse(r => r.url().endsWith('/api/me') && r.request().method() === 'DELETE');
    await confirm.click();
    expect((await deleted).status()).toBe(200);

    await expect.poll(() => page.evaluate(() => localStorage.getItem('flops_auth_token'))).toBeNull();
    const me = await request.get(`${cfg.apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status()).toBe(401);
  });

  test('report a problem opens from the screen and submits', async ({ page, request }) => {
    await openAuthed(page, request, '/history');

    const trigger = page.getByRole('button', { name: 'Report a problem' });
    await trigger.scrollIntoViewIfNeeded();
    const box = await trigger.boundingBox();
    expect(box.height, 'touch target').toBeGreaterThanOrEqual(44);
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Report a problem' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('What went wrong').fill('E2E smoke: chart looked blank');
    const sent = page.waitForResponse(r => r.url().includes('/api/problem-reports') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    const res = await sent;
    expect(res.status()).toBe(201);
    expect((await res.json()).route).toBe('/history');
    await expect(dialog.getByText(/on the list/i)).toBeVisible();
  });
});
