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
});
