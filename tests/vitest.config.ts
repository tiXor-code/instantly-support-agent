import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: 'n8n',
    root: HERE,
    environment: 'node',
    globals: true,
    include: ['n8n/__tests__/**/*.test.{js,mjs}'],
    globalSetup: [resolve(HERE, 'n8n/setup.mjs')],
  },
});
