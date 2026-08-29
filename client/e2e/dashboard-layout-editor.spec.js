import { test, expect } from '@playwright/test';
import { openAuthed } from './helpers/auth.js';
import { cfg } from './helpers/config.js';

const EDIT_URL = cfg.editPath;
const MAX_MACROS_HEIGHT_PX = cfg.thresholds.macrosMaxHeightPx;

test.describe('Dashboard layout editor', () => {
  test.beforeEach(async ({ page, request }) => {
    await openAuthed(page, request, EDIT_URL);
  });

  test('opens edit mode with compact cards', async ({ page }) => {
    await expect(page.getByRole('status')).toContainText('Customizing Today');
    await expect(page.locator('.dashboard-canvas--edit')).toBeVisible();

    const macros = page.locator('.react-grid-item[data-card-id="macros"]');
    await expect(macros).toBeVisible();

    const box = await macros.boundingBox();
    expect(box).toBeTruthy();
    expect(box.height).toBeLessThan(MAX_MACROS_HEIGHT_PX);

    const handles = page.locator('.react-grid-item .react-resizable-handle');
    await expect(handles.first()).toBeVisible();
    expect(await handles.count()).toBeGreaterThanOrEqual(4);
  });

  test('drags a card via the handle', async ({ page }) => {
    const weight = page.locator('.react-grid-item[data-card-id="weight"]');
    await expect(weight).toBeVisible();

    const before = await weight.boundingBox();
    expect(before).toBeTruthy();

    const handle = weight.locator('.dashboard-card__drag-handle');
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2, before.y + 120, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(400);

    const after = await weight.boundingBox();
    expect(after).toBeTruthy();
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(cfg.thresholds.minDragDeltaPx);
  });

  test('exposes corner resize handles on visible cards', async ({ page }) => {
    const items = page.locator('.react-grid-item[data-card-id]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      await expect(item.locator('.react-resizable-handle-se')).toBeVisible();
    }
  });
});
