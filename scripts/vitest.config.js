import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: 'scripts',
    root: HERE,
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.js', 'lib/**/*.test.js'],
  },
});
