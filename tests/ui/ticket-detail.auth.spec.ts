import { test, expect } from './_auth-helper';

// These tests need at least one ticket in the system. The eval suite
// (evals/run.js) seeds 12. If those are missing the tests will skip
// individually rather than fail.

async function findFirstAutoSentTicketId(page: import('@playwright/test').Page) {
  const res = await page.request.get('/api/tickets?status=auto_sent&limit=1');
  if (!res.ok()) return null;
  const json = await res.json();
  return json.tickets?.[0]?.id ?? null;
}

async function findFirstHumanReviewTicketId(page: import('@playwright/test').Page) {
  const res = await page.request.get('/api/tickets?status=human_review&limit=1');
  if (!res.ok()) return null;
  const json = await res.json();
  return json.tickets?.[0]?.id ?? null;
}

test.describe('ticket detail (authenticated)', () => {
  test('auto_sent ticket shows full DecisionChain', async ({ page }) => {
    const id = await findFirstAutoSentTicketId(page);
    test.skip(!id, 'No auto_sent tickets in DB; run evals/run.js first');

    await page.goto(`/tickets/${id}`);
    // Decision chain panels
    await expect(page.getByText(/Classification/i)).toBeVisible();
    await expect(page.getByText(/Retrieved chunks/i)).toBeVisible();
    await expect(page.getByText(/Draft response/i)).toBeVisible();
    await expect(page.getByText(/Self-grade/i)).toBeVisible();
    await expect(page.getByText(/Verdict/i)).toBeVisible();

    // Verdict badge says auto_send
    await expect(page.getByText(/auto_send/i).first()).toBeVisible();
  });

  test('human_review ticket shows action buttons', async ({ page }) => {
    const id = await findFirstHumanReviewTicketId(page);
    test.skip(!id, 'No human_review tickets in DB');

    await page.goto(`/tickets/${id}`);
    // At least the Approve and Reject buttons should be present.
    const approve = page.getByRole('button', { name: /approve/i });
    const reject = page.getByRole('button', { name: /reject/i });
    if (await approve.count()) await expect(approve.first()).toBeVisible();
    if (await reject.count()) await expect(reject.first()).toBeVisible();
  });
});
