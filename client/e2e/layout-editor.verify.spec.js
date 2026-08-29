/**
 * Single-file layout editor verification — run with:
 *   npm run verify:layout-editor
 *
 * Writes client/e2e/reports/layout-editor-report.json and prints a summary.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './helpers/config.js';
import { openAuthed, fetchProfileLayout } from './helpers/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');

const report = {
  at: new Date().toISOString(),
  target: cfg.baseURL,
  api: cfg.apiBase,
  external: cfg.external,
  thresholds: cfg.thresholds,
  checks: [],
  profileLayout: null,
  metrics: {},
  pass: false,
};

function record(id, ok, detail) {
  report.checks.push({ id, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id}: ${detail}`);
}

test.describe('Layout editor verify (one-shot)', () => {
  test('full verification report', async ({ page, request }, testInfo) => {
    const REPORT_FILE = path.join(REPORT_DIR, `layout-editor-report-${testInfo.project.name}.json`);
    const viewport = testInfo.project.name.includes('mobile')
      ? cfg.viewports.mobile
      : cfg.viewports.desktop;
    await page.setViewportSize(viewport);

    try {
      const { layout } = await fetchProfileLayout(request);
      report.profileLayout = layout;
      const macrosSaved = layout?.cards?.find(c => c.id === 'macros');
      record(
        'profile-layout-readable',
        true,
        macrosSaved
          ? `saved macros h=${macrosSaved.h}`
          : 'no saved layout yet (defaults — OK for new accounts)',
      );
      if (macrosSaved?.h > 8) {
        record(
          'saved-macros-not-inflated',
          false,
          `saved macros h=${macrosSaved.h} is very large — edit mode should still compact on entry`,
        );
      } else {
        record('saved-macros-not-inflated', true, `saved macros h=${macrosSaved?.h ?? 'n/a'}`);
      }
    } catch (e) {
      record('profile-layout-readable', false, e.message);
    }

    await openAuthed(page, request, cfg.editPath);

    const banner = page.getByRole('status');
    const bannerOk = await banner.filter({ hasText: 'Customizing Today' }).isVisible();
    record('edit-banner', bannerOk, bannerOk ? 'Customizing Today visible' : 'banner missing');

    const canvas = page.locator('.dashboard-canvas--edit');
    const canvasOk = await canvas.isVisible();
    record('edit-canvas', canvasOk, canvasOk ? 'grid edit canvas visible' : 'no .dashboard-canvas--edit');

    const macros = page.locator('.react-grid-item[data-card-id="macros"]');
    const macrosVisible = await macros.isVisible();
    let macrosHeight = null;
    if (macrosVisible) {
      const box = await macros.boundingBox();
      macrosHeight = box?.height ?? null;
      report.metrics.macrosHeightPx = macrosHeight;
      const compact = macrosHeight != null && macrosHeight < cfg.thresholds.macrosMaxHeightPx;
      record(
        'macros-compact',
        compact,
        `height=${macrosHeight}px (max ${cfg.thresholds.macrosMaxHeightPx})`,
      );
    } else {
      record('macros-compact', false, 'macros grid item not found');
    }

    const dragHandle = page.locator('.dashboard-card__drag-handle').first();
    const dragHandleOk = await dragHandle.isVisible();
    record('drag-handle-visible', dragHandleOk, dragHandleOk ? 'handle visible' : 'no drag handle');

    const resizeCount = await page.locator('.react-resizable-handle-se').count();
    const resizeOk = resizeCount >= 4;
    record('resize-handles', resizeOk, `${resizeCount} SE handles (need ≥4)`);

    const overflow = await page.evaluate((tolerance) => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    }, cfg.thresholds.maxHorizontalOverflowPx);
    report.metrics.horizontalOverflowPx = overflow;
    const noHScroll = overflow <= cfg.thresholds.maxHorizontalOverflowPx;
    record(
      'no-horizontal-overflow',
      noHScroll,
      `overflow=${overflow}px (max ${cfg.thresholds.maxHorizontalOverflowPx})`,
    );

    if (macrosVisible && dragHandleOk && testInfo.project.name.includes('desktop')) {
      const weight = page.locator('.react-grid-item[data-card-id="weight"]');
      if (await weight.isVisible()) {
        const before = await weight.boundingBox();
        const handle = weight.locator('.dashboard-card__drag-handle');
        await handle.hover();
        await page.mouse.down();
        await page.mouse.move(before.x + before.width / 2, before.y + 120, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const after = await weight.boundingBox();
        const delta = Math.abs((after?.y ?? 0) - (before?.y ?? 0));
        report.metrics.dragDeltaPx = delta;
        const dragOk = delta >= cfg.thresholds.minDragDeltaPx;
        record('drag-moves-card', dragOk, `y delta=${delta}px (min ${cfg.thresholds.minDragDeltaPx})`);
      } else {
        record('drag-moves-card', false, 'weight card not visible');
      }
    }

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    report.metrics.consoleErrors = consoleErrors;
    record('no-console-errors', consoleErrors.length === 0, `${consoleErrors.length} console errors`);

    report.pass = report.checks.every(c => c.ok);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`\nReport: ${REPORT_FILE}`);
    console.log(report.pass ? '\n✅ LAYOUT EDITOR VERIFY: PASS' : '\n❌ LAYOUT EDITOR VERIFY: FAIL');

    expect(report.pass, `See ${REPORT_FILE}`).toBe(true);
  });
});
