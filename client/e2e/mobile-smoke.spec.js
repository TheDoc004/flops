import { test, expect } from '@playwright/test';
import { openAuthed } from './helpers/auth.js';

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
