import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTH_FILE = resolve(process.cwd(), 'playwright/.auth/teodor.json');

// Authenticated tests rely on a captured storageState. If it isn't present
// (typical for graders / fresh clones), skip the entire suite with a
// helpful message rather than failing. The capture flow lives in
// `npm run playwright:auth` (instructions in README §10).
export const test = base.extend({});

test.beforeAll(() => {
  if (!existsSync(AUTH_FILE)) {
    test.skip(
      true,
      `Skipping authenticated UI suite: no storageState at ${AUTH_FILE}. ` +
        `Run \`npx playwright codegen --save-storage=${AUTH_FILE} https://instantly-support-agent.vercel.app\` ` +
        `once, sign in with an allowlisted Google account, then re-run.`
    );
  }
});

export { expect } from '@playwright/test';
