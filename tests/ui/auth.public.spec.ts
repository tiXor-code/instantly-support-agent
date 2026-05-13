import { test, expect } from '@playwright/test';

// These tests require NO authentication. They prove the auth gate is closed
// for unauthenticated visitors and that the signin entry point renders.

test.describe('auth gate (signed out)', () => {
  test('GET / redirects to /auth/signin', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    // NextAuth middleware either issues a 307 redirect or the page itself
    // sends the user there client-side. Either way, the final URL must be
    // the signin page.
    expect(page.url()).toMatch(/\/auth\/signin/);
    expect(response?.status()).toBeLessThan(500);
  });

  test('signin page renders with Google sign-in button', async ({ page }) => {
    await page.goto('/auth/signin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
  });

  test('signed-out access to /tickets/<random-id> still goes through signin', async ({ page }) => {
    await page.goto('/tickets/00000000-0000-0000-0000-000000000000', {
      waitUntil: 'domcontentloaded',
    });
    expect(page.url()).toMatch(/\/auth\/signin/);
  });

  test('signed-out access to /settings still goes through signin', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toMatch(/\/auth\/signin/);
  });
});
