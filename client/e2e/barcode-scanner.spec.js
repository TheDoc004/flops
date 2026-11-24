import { test, expect } from '@playwright/test';
import { openAuthed } from './helpers/auth.js';

const MOBILE = { width: 390, height: 844 };

// Synthetic product (valid EAN-13 check digit). /api/barcode/* is stubbed, so
// Open Food Facts is never called.
const BARCODE = '4000000000006';
const PRODUCT = {
  found: true,
  barcode: BARCODE,
  name: 'E2E Test Oats',
  brand_name: 'Fixture Foods',
  serving_amount: 40,
  serving_unit: 'g',
  serving_size_text: '40 g',
  basis: 'serving',
  macros: { calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3, fiber_g: 4 },
  micros: {},
  existing_ingredient: null,
};

test.describe('Barcode scanner over the Add ingredient form (390px)', () => {
  test.use({ viewport: MOBILE });

  test('opens on top of the form: typing, Look up and Escape all work', async ({ page, request }) => {
    await page.route('**/api/barcode/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRODUCT) }));

    await openAuthed(page, request, '/ingredients');
    await page.getByRole('button', { name: '+ Add ingredient' }).click();
    const form = page.locator('dialog').filter({ hasText: 'Add a new ingredient' });
    await expect(form).toBeVisible();

    // First pass: the scanner must be reachable, and Escape closes only it.
    await form.getByRole('button', { name: 'Scan barcode', exact: true }).click();
    const scanner = page.getByRole('dialog', { name: 'Scan a barcode' });
    await expect(scanner).toBeVisible();
    const input = scanner.getByLabel('Barcode number');
    // A real click: fails if the form dialog sits on top of the scanner.
    await input.click({ timeout: 5_000 });
    await page.keyboard.type(BARCODE);
    await expect(input).toHaveValue(BARCODE);
    await page.keyboard.press('Escape');
    await expect(scanner).toHaveCount(0);
    await expect(form).toBeVisible();

    // Second pass: Look up fills the form from the (stubbed) product.
    await form.getByRole('button', { name: 'Scan barcode', exact: true }).click();
    await expect(scanner).toBeVisible();
    await input.click({ timeout: 5_000 });
    await page.keyboard.type(BARCODE);
    const lookedUp = page.waitForResponse(r => r.url().includes(`/api/barcode/${BARCODE}`));
    await scanner.getByRole('button', { name: 'Look up' }).click({ timeout: 5_000 });
    await lookedUp;
    await expect(scanner).toHaveCount(0);
    await expect(form).toBeVisible();
    const values = await form.locator('input').evaluateAll(els => els.map(el => el.value));
    expect(values).toContain('E2E Test Oats');
  });
});
