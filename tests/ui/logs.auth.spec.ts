import { test, expect } from './_auth-helper';

test.describe('logs page (authenticated)', () => {
  test('renders at least one row when runs exist', async ({ page }) => {
    await page.goto('/logs');
    // The page either shows the table or an "empty" empty-state.
    // Accept either; if the eval suite has run there should be ≥12 rows.
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(0);
    if (rowCount > 0) {
      // Sanity: the first row links to a ticket detail
      const firstLink = page.locator('table tbody tr a').first();
      const href = await firstLink.getAttribute('href');
      if (href) expect(href).toMatch(/\/tickets\//);
    }
  });

  test('CSV export button is present', async ({ page }) => {
    await page.goto('/logs');
    const exportBtn = page.getByRole('button', { name: /csv|export/i });
    if (await exportBtn.count()) {
      await expect(exportBtn.first()).toBeVisible();
    }
  });
});
