import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './dashboard/vitest.config.ts',
  './scripts/vitest.config.js',
  './tests/vitest.config.ts',
]);
