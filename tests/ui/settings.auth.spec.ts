import { test, expect } from './_auth-helper';

test.describe('settings page (authenticated)', () => {
  test('renders four threshold inputs with current values', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/cosine[_ ]?floor/i).first()).toBeVisible();
    await expect(page.getByText(/cosine[_ ]?margin/i).first()).toBeVisible();
    await expect(page.getByText(/self[_ ]?grade[_ ]?floor/i).first()).toBeVisible();
    await expect(page.getByText(/hard[_ ]?floor/i).first()).toBeVisible();
  });

  test('PATCH round-trip persists threshold change', async ({ page }) => {
    // Read current cosine_floor via the API
    const r1 = await page.request.get('/api/settings');
    expect(r1.ok()).toBeTruthy();
    const before = (await r1.json()).settings.cosine_floor;

    // Bump it then restore — assert the GET reflects the bump
    const bumped = Number((Number(before) + 0.05).toFixed(3));
    const r2 = await page.request.patch('/api/settings', {
      data: { cosine_floor: bumped },
    });
    expect(r2.ok()).toBeTruthy();
    const r3 = await page.request.get('/api/settings');
    expect((await r3.json()).settings.cosine_floor).toBe(bumped);

    // Restore
    await page.request.patch('/api/settings', { data: { cosine_floor: before } });
    const r4 = await page.request.get('/api/settings');
    expect((await r4.json()).settings.cosine_floor).toBe(before);
  });
});
