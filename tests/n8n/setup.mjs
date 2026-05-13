// vitest globalSetup: extract code-node bodies from the workflow JSON once
// before any worker boots. Idempotent — safe to call repeatedly.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const extractor = resolve(HERE, 'extract-code-nodes.mjs');

export async function setup() {
  const r = spawnSync(process.execPath, [extractor], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`code-node extractor failed (exit ${r.status})`);
  }
}

export async function teardown() {
  // Keep extracted files between runs — they're cheap to regenerate and
  // reading them under coverage/inspection is sometimes useful.
}
