#!/usr/bin/env node
// instantly-support-agent — eval harness
//
// POSTs each ticket in evals/tickets.json through /api/webhook/ticket-in,
// polls Supabase until ticket status is terminal (auto_sent / human_review /
// rejected / sent / error / cannot_answer reflected via the latest run),
// then prints a per-ticket result table + headline numbers (auto_response
// rate, agreement with expected_verdict).
//
// Required env (read from ../.env or ../.env.local):
//   DASHBOARD_BASE_URL                     (e.g. https://instantly-support-agent.vercel.app)
//   INBOUND_WEBHOOK_HMAC_SECRET            (matches the dashboard's secret)
//   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
//
// Run:   node evals/run.js
// Filter: node evals/run.js eval-howto-1 eval-billing-2
// CSV:   CSV=1 node evals/run.js > evals/.results/run-$(date +%s).csv

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

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

const DASHBOARD_BASE = (process.env.DASHBOARD_BASE_URL || 'https://instantly-support-agent.vercel.app').replace(/\/$/, '');
const HMAC_SECRET = process.env.INBOUND_WEBHOOK_HMAC_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV = process.env.CSV === '1';

if (!HMAC_SECRET) {
  console.error('Missing INBOUND_WEBHOOK_HMAC_SECRET');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const FILTER = new Set(process.argv.slice(2));
const ALL = JSON.parse(readFileSync(resolve(HERE, 'tickets.json'), 'utf8')).tickets;
const TICKETS = FILTER.size ? ALL.filter((t) => FILTER.has(t.id)) : ALL;

function sign(body) {
  return 'sha256=' + createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

async function postTicket(t) {
  const body = JSON.stringify({
    external_id: `eval-run-${Date.now()}-${t.id}`,
    subject: t.subject,
    body: t.body,
    customer_email: t.customer_email,
  });
  const res = await fetch(`${DASHBOARD_BASE}/api/webhook/ticket-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-instantly-signature': sign(body),
    },
    body,
  });
  if (!res.ok) throw new Error(`POST ${res.status}: ${await res.text()}`);
  return (await res.json()).ticket_id;
}

async function waitForTerminal(ticketId, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data: latestRun } = await supabase
      .from('ticket_runs')
      .select('verdict, verdict_reason, top_chunks, self_grade, draft_response, latency_ms')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRun) return latestRun;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout waiting for verdict on ${ticketId}`);
}

function expectedToActual(expected, verdict) {
  // expected_verdict is the broad routing decision the system should make.
  // 'cannot_answer' is treated as a human-review outcome for accuracy.
  const norm = (v) => (v === 'cannot_answer' ? 'human_review' : v);
  return norm(expected) === norm(verdict);
}

async function main() {
  const rows = [];
  for (const t of TICKETS) {
    process.stderr.write(`▶ ${t.id} — ${t.subject.slice(0, 60)}…\n`);
    try {
      const ticketId = await postTicket(t);
      const run = await waitForTerminal(ticketId);
      const top1 = run.top_chunks?.[0]?.score ?? null;
      const sgMin = run.self_grade
        ? Math.min(run.self_grade.grounded_in_cited_doc, run.self_grade.directly_answers_question)
        : null;
      const agreed = expectedToActual(t.expected_verdict, run.verdict);
      rows.push({
        id: t.id,
        category: t.category,
        expected: t.expected_verdict,
        actual: run.verdict,
        agreed,
        verdict_reason: run.verdict_reason,
        top1: top1 != null ? top1.toFixed(3) : '—',
        sg: sgMin ?? '—',
        latency_ms: run.latency_ms ?? '—',
      });
    } catch (err) {
      rows.push({
        id: t.id,
        category: t.category,
        expected: t.expected_verdict,
        actual: 'ERROR',
        agreed: false,
        verdict_reason: String(err.message || err).slice(0, 80),
        top1: '—',
        sg: '—',
        latency_ms: '—',
      });
    }
  }

  if (CSV) {
    console.log('id,category,expected,actual,agreed,top1,sg,latency_ms,verdict_reason');
    for (const r of rows) {
      console.log([r.id, r.category, r.expected, r.actual, r.agreed, r.top1, r.sg, r.latency_ms, JSON.stringify(r.verdict_reason)].join(','));
    }
    return;
  }

  // Pretty table
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log();
  console.log(w('id', 18), w('category', 17), w('expected', 14), w('actual', 14), w('✓', 3), w('top1', 6), w('sg', 4), w('lat', 7), 'reason');
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      w(r.id, 18),
      w(r.category, 17),
      w(r.expected, 14),
      w(r.actual, 14),
      w(r.agreed ? '✓' : '✗', 3),
      w(r.top1, 6),
      w(r.sg, 4),
      w(r.latency_ms, 7),
      r.verdict_reason
    );
  }

  const total = rows.length;
  const autoSent = rows.filter((r) => r.actual === 'auto_send').length;
  const agreed = rows.filter((r) => r.agreed).length;
  const errors = rows.filter((r) => r.actual === 'ERROR').length;
  console.log();
  console.log(`auto-send rate:  ${autoSent}/${total} (${((autoSent / total) * 100).toFixed(0)}%)`);
  console.log(`agreement:       ${agreed}/${total} (${((agreed / total) * 100).toFixed(0)}%)`);
  if (errors) console.log(`errors:          ${errors}`);
  console.log();
  console.log('per-category breakdown:');
  const cats = [...new Set(rows.map((r) => r.category))];
  for (const c of cats) {
    const cs = rows.filter((r) => r.category === c);
    const csAuto = cs.filter((r) => r.actual === 'auto_send').length;
    const csAgreed = cs.filter((r) => r.agreed).length;
    console.log(`  ${w(c, 18)}  auto ${csAuto}/${cs.length}  agreed ${csAgreed}/${cs.length}`);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
