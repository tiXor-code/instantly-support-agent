#!/usr/bin/env node
// instantly-support-agent — adversarial E2E checks
//
// Hits the live deployment with deliberately bad requests and asserts the
// system rejects them correctly. This is the cheap "is the gate actually
// closed?" test — complements run.js (which is the "does the happy path
// produce sensible answers?" test).
//
// Required env:
//   DASHBOARD_BASE_URL                     (default: https://instantly-support-agent.vercel.app)
//   INBOUND_WEBHOOK_HMAC_SECRET            (the real secret — used to construct *valid* signatures
//                                          where the test needs them)
//   N8N_CALLBACK_SECRET                    (the real callback token)
//
// Run:   node evals/adversarial.js
// Exits non-zero on any failure so this is CI-friendly.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
for (const envFile of ['.env.local', '.env']) {
  try {
    const txt = readFileSync(resolve(HERE, '..', envFile), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const BASE = (
  process.env.DASHBOARD_BASE_URL || 'https://instantly-support-agent.vercel.app'
).replace(/\/$/, '');
const HMAC_SECRET = process.env.INBOUND_WEBHOOK_HMAC_SECRET;
const CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;

if (!HMAC_SECRET || !CALLBACK_SECRET) {
  console.error('Missing INBOUND_WEBHOOK_HMAC_SECRET or N8N_CALLBACK_SECRET');
  process.exit(1);
}

function sign(rawBody, secret = HMAC_SECRET) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

let pass = 0;
let fail = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} — ${detail}`);
  }
}

async function caseBadHmac() {
  const body = JSON.stringify({
    subject: 'Adversarial', body: 'bad sig', customer_email: 'x@x.com',
  });
  const res = await fetch(`${BASE}/api/webhook/ticket-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-instantly-signature': 'sha256=deadbeef' },
    body,
  });
  check('bad HMAC → 401', res.status === 401, `got ${res.status}`);
}

async function caseMissingField() {
  const body = JSON.stringify({ subject: 'only subject' });
  const res = await fetch(`${BASE}/api/webhook/ticket-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-instantly-signature': sign(body) },
    body,
  });
  check('missing required field → 400', res.status === 400, `got ${res.status}`);
}

async function caseReplay() {
  // Send the same external_id twice. Second call must come back deduped.
  const externalId = `adv-replay-${randomUUID()}`;
  const body = JSON.stringify({
    external_id: externalId,
    subject: 'Adversarial replay',
    body: 'first',
    customer_email: 'replay@x.com',
  });

  const headers = { 'content-type': 'application/json', 'x-instantly-signature': sign(body) };
  const r1 = await fetch(`${BASE}/api/webhook/ticket-in`, { method: 'POST', headers, body });
  const j1 = await r1.json().catch(() => ({}));
  const r2 = await fetch(`${BASE}/api/webhook/ticket-in`, { method: 'POST', headers, body });
  const j2 = await r2.json().catch(() => ({}));
  check(
    'replay same external_id → second call deduped:true',
    r1.status === 200 && r2.status === 200 && j2.deduped === true && j2.ticket_id === j1.ticket_id,
    `r1=${r1.status} ${JSON.stringify(j1)} r2=${r2.status} ${JSON.stringify(j2)}`
  );
}

async function caseNonJson() {
  const raw = 'not even close to json';
  const res = await fetch(`${BASE}/api/webhook/ticket-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-instantly-signature': sign(raw) },
    body: raw,
  });
  check('non-JSON body with valid HMAC → 400', res.status === 400, `got ${res.status}`);
}

async function caseSpoofedCallback() {
  const body = JSON.stringify({
    ticket_id: '00000000-0000-0000-0000-000000000000',
    verdict: 'auto_send',
    verdict_reason: 'spoof',
  });
  const res = await fetch(`${BASE}/api/webhook/n8n-callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-n8n-token': 'definitely-not-the-secret' },
    body,
  });
  check('spoofed n8n callback token → 401', res.status === 401, `got ${res.status}`);
}

async function caseMissingCallbackToken() {
  const body = JSON.stringify({ ticket_id: 'x', verdict: 'auto_send' });
  const res = await fetch(`${BASE}/api/webhook/n8n-callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  check('missing n8n callback token → 401', res.status === 401, `got ${res.status}`);
}

async function caseAuthRequiredOnAction() {
  const res = await fetch(`${BASE}/api/tickets/00000000-0000-0000-0000-000000000000/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  check('unauthenticated /action POST → 401', res.status === 401, `got ${res.status}`);
}

console.log(`adversarial checks against ${BASE}\n`);
await caseBadHmac();
await caseMissingField();
await caseNonJson();
await caseReplay();
await caseSpoofedCallback();
await caseMissingCallbackToken();
await caseAuthRequiredOnAction();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
