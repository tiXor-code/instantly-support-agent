import { test, expect } from './_auth-helper';

test.describe('queue page (authenticated)', () => {
  test('renders Review queue heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /review queue/i })).toBeVisible();
  });

  test('clicking a ticket row navigates to ticket detail', async ({ page }) => {
    await page.goto('/');
    const firstRow = page.getByRole('row').nth(1); // skip header row
    await firstRow.click();
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]+$/);
  });

  test('category filter updates URL', async ({ page }) => {
    await page.goto('/');
    const categorySelect = page.getByRole('combobox', { name: /category/i });
    if (await categorySelect.count()) {
      await categorySelect.selectOption({ index: 1 });
      await expect(page).toHaveURL(/[?&]category=/);
    }
  });
});
