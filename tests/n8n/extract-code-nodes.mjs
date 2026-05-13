#!/usr/bin/env node
// Extract every Code-node body from n8n/workflow-respond-ticket.json into
// individual ESM files under tests/n8n/extracted/. Each file exports a
// `run({ items, $env })` function that wraps the node's JS in the same way
// n8n itself wraps it: items are returned, $env is the env-var bag, and
// `$input.all()` / `$input.first()` are emulated against the passed items.
//
// Why this matters: the verdict gate, short-circuit logic, and prompt
// assembly all live as JS strings inside the workflow JSON. Without this
// extractor, those bodies cannot be unit-tested, which means no truth
// table for the multi-signal gate. Generating the test fixtures from the
// workflow guarantees the tests can never silently drift.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKFLOW = resolve(REPO, 'n8n', 'workflow-respond-ticket.json');
const OUT = resolve(HERE, 'extracted');

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const wf = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
const codeNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const indexEntries = [];

for (const node of codeNodes) {
  const slugName = slug(node.name);
  const file = resolve(OUT, `${slugName}.mjs`);
  const body = node.parameters.jsCode || '';

  // Build a tiny n8n-shim that emulates the bits of the n8n runtime the
  // code nodes actually use:
  //   $input.all()      → array of { json } objects
  //   $input.first()    → first { json } object
  //   $env              → object of env vars
  //   $json             → first item's .json (matches n8n's "Run Once for
  //                       All Items" default behavior — we don't use Per
  //                       Item mode in this workflow)
  //   $jmespath, $vars  → not used; left undefined
  //   The code node returns either a single object (auto-wrapped to
  //   [{ json: ... }]) or an array of { json: ... } items.
  const wrapped = `// AUTO-GENERATED from n8n/workflow-respond-ticket.json — node "${node.name}".
// Do not edit. Run \`npm run test:n8n:extract\` to regenerate.

export const NODE_NAME = ${JSON.stringify(node.name)};

// Run the extracted code-node body with a synthetic n8n runtime.
//   items     — main input items (becomes $input.all() / $input.first())
//   env       — env-var bag exposed as $env
//   upstream  — { 'Node Name': [items] } map for cross-node \`$('X')\` lookups
export function run({ items = [], env = {}, upstream = {} } = {}) {
  const wrap = (arr) => arr.map((it) => ({ json: it.json ?? it }));
  const itemsCopy = wrap(items);
  const $input = {
    all: () => itemsCopy,
    first: () => itemsCopy[0],
    last: () => itemsCopy[itemsCopy.length - 1],
    item: { json: itemsCopy[0]?.json ?? {} },
  };
  const $env = env;
  const $json = itemsCopy[0]?.json ?? {};
  const $ = (nodeName) => {
    const arr = wrap(upstream[nodeName] || []);
    return {
      all: () => arr,
      first: () => arr[0] ?? { json: {} },
      last: () => arr[arr.length - 1] ?? { json: {} },
      item: { json: arr[0]?.json ?? {} },
    };
  };

  ${body}
}
`;
  writeFileSync(file, wrapped, 'utf8');
  indexEntries.push({ slug: slugName, name: node.name, file });
}

writeFileSync(
  resolve(OUT, 'index.json'),
  JSON.stringify(indexEntries, null, 2),
  'utf8'
);

console.log(`Extracted ${codeNodes.length} code nodes to ${OUT}`);
