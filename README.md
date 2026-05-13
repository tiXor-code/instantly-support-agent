# instantly-support-agent

> Take-home Task B for the **Instantly.ai AI Automation Engineer** role.
> Auto-responds to support tickets when confident, routes to humans when not.

**Live demo:** https://instantly-support-agent.vercel.app
**Repo:** https://github.com/tiXor-code/instantly-support-agent
**Loom walkthrough:** *(to be added once thresholds are tuned on the live system)*

## What it does

Receives a support ticket via webhook → classifies it → embeds it → retrieves the most similar chunks from an indexed copy of `help.instantly.ai/en` → drafts a cited response → self-grades the draft → applies a multi-signal confidence gate to decide *auto-send vs. human review* → logs every step. Every reviewer sees the full decision chain on one page.

Eighteen help-center articles are indexed across the five categories the JD calls out (setup, deliverability, campaigns, billing, integrations) — 130 chunks at 1536-dim using `text-embedding-3-small` on Azure OpenAI, stored in Supabase pgvector with an HNSW index.

## Architecture

```
[Webhook source: curl / Front / Zendesk]
            ↓ HMAC-signed POST
[Vercel Next.js dashboard] ──────── Google SSO + email allowlist
            │                            │
            │ inbound ingest             │ review queue, logs, settings UI
            ↓                            ↑
       [Supabase Postgres]               │
       (pgvector + RLS)                  │
            ↑                            │
            │ webhook trigger via        │
            │ Cloudflare Tunnel          │
            ↓                            │
[Mac Mini n8n: workflow-respond-ticket]  │
       │                                 │
       ├──► Azure GPT-4o-mini  classify  │
       ├──► Azure embeddings   retrieve  │
       ├──► Supabase RPC       match k=4 │
       ├──► Claude CLI (sub)   draft     │
       ├──► Azure GPT-4o-mini  self-grade│
       └──► Compute multi-signal verdict │
                                         │
            callback (x-n8n-token) ──────┘
```

Two reliability workflows hang off the main one:
- `workflow-error-retry.json` catches any failure in the main workflow, retries up to 3× with backoff, then writes `status='error'` and posts a structured failure callback
- `workflow-drain-pending.json` runs every 10 min, finds tickets stuck in `processing` for >5 min (e.g. tunnel was down at the time of dispatch), and re-fires them

## Confidence threshold design

This is the core of the task. Three levers, each independently tunable in production:

| Lever | Signal | Default | Role |
|---|---|---|---|
| **Hard floor** | `top1_cosine ≥ hard_floor_top1_cosine` | 0.50 | If top-1 retrieval similarity is below this, short-circuit to `cannot_answer` (no doc plausibly answers — drafting would just hallucinate). |
| **L1: Retrieval gate** | `top1 ≥ cosine_floor` AND `(top1 − top2) ≥ cosine_margin` | 0.78, 0.05 | Catches "no doc actually answers this" + "two equally bad chunks" ambiguity. |
| **L2: Self-grade gate** | `min(grounded_in_cited_doc, directly_answers_question) ≥ self_grade_floor` | 4 / 5 | Catches "doc was retrieved but doesn't actually address the specific situation" — the failure mode pure cosine misses. |

Auto-send requires **both L1 AND L2 to pass**. If either fails, the ticket routes to the human queue with a structured `verdict_reason` like `top1_cosine_below_floor (0.71 < 0.78)` or `self_grade_below_floor (min=3 < 4)`.

**Why three independent levers, not one composite score:** each lever surfaces a different failure mode and is tunable separately in production. We can lower L1 to catch more long-tail edges without touching L2 (which is about answer quality, not retrieval quality). A single composite score collapses these axes and we lose diagnostic clarity.

**Why classification is metadata, not a hard gate:** every ticket attempts the full pipeline regardless of category. Bug reports, feature requests, and account issues *almost always* fail at L1 or L2 anyway (the docs don't cover those situations) — but the rare bug report whose answer genuinely exists in the KB ("tracking pixel broken → see this doc") will be auto-handled correctly. The `draft.v1` prompt is category-conditioned to be conservative on those types and emit `cannot_answer` when the chunks don't directly support an answer; that's caught at the verdict stage and routes to human.

## How to tune in production

You don't tune thresholds by intuition. You tune them by watching outcomes.

**Metrics to watch** (every metric below is queryable from the `ticket_runs` table — the dashboard's `/logs` view exports all of these as CSV):

| Metric | What it tells you | What to do |
|---|---|---|
| **Auto-send rebut rate** — % of auto-sent tickets where the customer replies "this didn't help" or escalates within 24h | False positives. Threshold is too low. | Raise `cosine_floor` by 0.02, or `self_grade_floor` from 4 → 5. |
| **Trivial-approval rate** — % of human-reviewed tickets where the reviewer approved-as-is with no edit | False negatives. Threshold is too high — humans are agreeing with the agent. | Lower `cosine_floor` by 0.02, or `cosine_margin` by 0.01. |
| **Per-category accuracy** — the same metric split by classification | Catches drift in specific categories | If `bug_report` rebuts spike, the draft prompt's bug-report guidance needs sharpening. If `billing` rebuts spike, the policy chunks may be stale. |
| **Latency p95** — total `latency_ms` per ticket | Whether the system meets SLO. | Switch the draft step from Claude CLI to Anthropic API direct (~2s saved per ticket but adds per-call cost). |
| **Cost per ticket** — Azure tokens × prices + (drafts × Claude CLI subscription quota use) | Budget tracking | Lower draft prompt verbosity, switch to a smaller Claude model, or limit drafts to high-cosine retrievals only. |

**Recommended cadence**: weekly review of the previous week's `ticket_runs` table. Focus on the two pathological cases: auto-sent-but-rebutted (real misses) and human-reviewed-but-trivially-approved (overcautious). Move thresholds 1 step at a time, never both at once. Keep a moving 7-day average — single tickets are noise.

**Expected initial behaviour at default thresholds** (estimated from the 12-ticket eval set in `evals/tickets.json`, will be refined with real numbers once n8n is live):

- ~40-50% auto-response rate
- ~90-100% per-ticket agreement with expected verdict
- Auto-send distribution skews to `how_to_question` (most of the auto-sends), with `billing` close behind. `bug_report` / `feature_request` / `account_issue` should auto-send only when an exact-match doc exists (rare but possible)

## Retrieval approach

- **Knowledge base**: 18 hand-picked URLs from `help.instantly.ai/en` covering setup, deliverability, campaigns, billing, integrations. List in `scripts/kb_urls.json`. Chosen for diversity and common-question coverage.
- **Scraping**: Playwright (Chromium) on the Mac Mini. Strips nav/footer/script/style; preserves H2/H3 section headings as chunk metadata. See `scripts/ingest_kb.js`.
- **Chunking**: paragraph-level with a hard cap of ~1000 tokens (4000 chars) and 100-token (400 char) overlap. Token-counting is character-based (4 chars ≈ 1 token for English prose) — close enough at this scale to not warrant a tiktoken dependency.
- **Embedding**: `text-embedding-3-small` (1536 dims) deployed on Azure OpenAI. Same model used at index time and query time.
- **Storage**: Supabase Postgres + pgvector + HNSW index (`m=16, ef_construction=64`) on `kb_chunks.embedding`.
- **Retrieval**: SQL function `match_kb_chunks(query_embedding, match_count=4)` runs cosine distance via `embedding <=> query_embedding`, returns chunk id + doc URL + title + content + similarity.

**Why text-embedding-3-small over alternatives**:

| Option | Why we picked / didn't |
|---|---|
| **`text-embedding-3-small` (Azure, 1536d)** | ~5x cheaper than `large` for negligible quality loss on English support text; HNSW index is comfortable at 1536d on Supabase free tier; Azure deployment keeps everything in one EU region. |
| `text-embedding-3-large` (3072d) | Marginally better recall on long technical docs but 5x cost + 2x storage; not worth it for an 18-doc KB. |
| Voyage AI `voyage-3` (1024d) | Strong on technical retrieval, free tier covers this. Skipped only because it adds a new account; would revisit if KB grew past ~1000 docs. |
| Hybrid BM25 + cosine | Adds engineering surface area for marginal gain at this scale. Worth it past ~10k chunks. |

## Prompts

Three versioned prompts in `prompts/`. Each contains a system prompt, JSON-pinned output schema, two few-shot examples, and a "v0 → v1 iteration notes" section explaining what failed in v0 and what changed.

| File | Used by | What it does |
|---|---|---|
| `classify.v1.md` | Classify node | Six-category classifier with confidence calibration anchors. JSON-pinned output. Conservative-on-ambiguity framing. |
| `draft.v1.md` | Draft node | The highest-stakes prompt — the only one that can fabricate. Forced citation, explicit `cannot_answer` escape hatch, per-category guidance for `bug_report` / `feature_request` / `account_issue` to be conservative when chunks don't directly support an answer. |
| `self_grade.v1.md` | Self-Grade node | Three orthogonal 1-5 axes (grounded, directly_answers, tone) with "be skeptical" framing to counter praise bias. |

The prompts live in two places: source-of-truth in version-controlled markdown files, and seed-able into the `settings` table for hot-editing on `/settings`. The n8n workflow code nodes contain the same text as inline fallbacks, so importing the workflow into a fresh n8n instance with no settings table seeded still works correctly.

## Failure modes handled

| Failure | Behaviour |
|---|---|
| Azure 5xx / timeout on classify or self-grade | n8n node-level retry 3× with backoff. Persistent → `workflow-error-retry` catches → `status='error'` + structured callback. |
| Claude CLI failure (e.g. subscription rate limit hit) | Caught in the Draft code node; verdict='human_review' with `verdict_reason='malformed_llm_output_draft'`; raw stderr preserved in `raw_llm_outputs`. |
| Azure embeddings failure | Fail closed → no retrieval → short-circuit to `cannot_answer` with reason `embedding_failed`. |
| Supabase RPC returns 0 rows | Fail closed → `cannot_answer` with reason `no_kb_match`. |
| `top1_cosine < hard_floor (0.5)` | Short-circuit to `cannot_answer` *without* drafting (saves the Claude CLI call). |
| JSON parse failure on any LLM output | Fail closed → `human_review` with reason `malformed_llm_output_<step>`; raw output preserved in `ticket_runs.raw_llm_outputs` for debugging. |
| Cloudflare Tunnel down at dispatch | Inbound webhook still ingests + persists; ticket sits in `status='processing'`. `workflow-drain-pending` (every 10 min) re-fires anything older than 5 min. |
| Duplicate inbound webhook (replay) | `tickets.external_id` unique constraint; second POST returns `200 { deduped: true }`, no second `ticket_runs` row. |
| Retrieval high cosine but wrong doc | Self-grade catches it; L2 fails; reason `self_grade_below_floor`. |
| Inbound HMAC mismatch | `/api/webhook/ticket-in` returns 401 before any DB write. |

## Sample analysis (will be refined with live numbers)

Once n8n is live, `node evals/run.js` produces a per-ticket table and the headline numbers below. The expected behaviour at default thresholds (`cosine_floor=0.78`, `cosine_margin=0.05`, `self_grade_floor=4`) on the 12-ticket eval set:

| Threshold combo | Expected auto-rate | Expected agreement | Tradeoff |
|---|---|---|---|
| **0.78 / 0.05 / 4** (default) | ~42% (5/12) | ~100% (12/12) | Balanced. Auto-sends only the highest-conviction cases. |
| 0.85 / 0.05 / 5 (aggressive strict) | ~20-25% | ~100% | Auto-sends only "obvious" how-to questions. Almost no false-positive risk. Use this in week 1 of production. |
| 0.72 / 0.03 / 4 (loose) | ~55-60% | ~85-90% | Catches more how-to and billing edge cases but risks 1-2 rebuts per 10 auto-sends. |

The system is deliberately conservative at default. The first month in production should run at the strict end (cosine_floor=0.85 / self_grade_floor=5) until the rebut-rate data justifies loosening.

## Quickstart

### 1. Set up Supabase

```bash
# Create a new Supabase project, then in the SQL Editor:
psql < supabase/schema.sql
```

This creates `kb_docs`, `kb_chunks` (pgvector + HNSW), `tickets`, `ticket_runs`, `ticket_status_history`, `settings`, and the `match_kb_chunks` RPC. Seeds 7 default settings rows.

### 2. Provision Azure OpenAI deployments

```bash
# Authenticate az CLI first.
az cognitiveservices account create \
  --name instantly-support-agent --resource-group <your-rg> \
  --kind OpenAI --sku S0 --location swedencentral --yes

az cognitiveservices account deployment create \
  --name instantly-support-agent --resource-group <your-rg> \
  --deployment-name gpt-4o-mini \
  --model-name gpt-4o-mini --model-version 2024-07-18 \
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50

az cognitiveservices account deployment create \
  --name instantly-support-agent --resource-group <your-rg> \
  --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small --model-version 1 \
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50
```

### 3. Configure environment

Copy `.env.example` to `.env`, fill in Supabase + Azure values. The dashboard reads its own subset; the ingest script and n8n workflows share the same names.

### 4. Index the knowledge base

```bash
cd scripts
npm install   # also installs Playwright Chromium
node ingest_kb.js
# → docs ok: 18/18, chunks: 130, embed dims: 1536
```

### 5. Deploy the dashboard

```bash
cd dashboard
npm install
vercel       # link, then push to main for auto-deploy
```

Configure these Vercel environment variables (Production):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`, `AUTH_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (and add `<deploy-url>/api/auth/callback/google` as an authorised redirect URI)
- `ALLOWED_EMAILS` (csv of dashboard users)
- `INBOUND_WEBHOOK_HMAC_SECRET`, `N8N_CALLBACK_SECRET`

### 6. Set up n8n on the Mac Mini (or any host)

See `n8n/SETUP.md` for the operator runbook. Summary:

1. Set Mac Mini env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `AZURE_ISA_*`, `DASHBOARD_CALLBACK_URL`, `N8N_CALLBACK_SECRET`
2. Open n8n, import all three JSONs from `n8n/`
3. Activate `Respond to Ticket`. Note the webhook URL inside n8n.
4. Configure Cloudflare Tunnel ingress: `<your-tunnel-host>/webhook/respond-ticket → http://localhost:5678/webhook/respond-ticket`
5. In dashboard `/settings`, paste the public tunnel URL into `n8n_webhook_url`
6. Activate `Error Retry` (auto-binds to all workflow errors)
7. Activate `Drain Pending Tickets` (runs every 10 min)

### 7. Send a test ticket

```bash
SECRET=<your INBOUND_WEBHOOK_HMAC_SECRET>
BODY='{"external_id":"smoke-1","subject":"How do I add an unsubscribe link?","body":"Where do I configure this in the editor?","customer_email":"smoke@example.com"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -X POST https://<your-deploy>.vercel.app/api/webhook/ticket-in \
  -H "x-instantly-signature: $SIG" \
  -H "content-type: application/json" \
  -d "$BODY"
# → {"ticket_id":"...","deduped":false}
```

Then watch the dashboard `/queue` or `/sent`.

### 8. Run the eval set

```bash
cd evals
npm install
DASHBOARD_BASE_URL=https://<your-deploy>.vercel.app node run.js
# Per-ticket table + headline auto-rate / agreement.
```

## What I'd improve with more time

- **Real customer-reply feedback loop into the threshold**: when a customer replies "this didn't help" within 24h of an auto-send, automatically adjust the threshold for that category up by 0.01. Same with positive replies in the other direction. Closes the loop without requiring weekly human curation.
- **Two-pass drafting**: first pass extracts a structured "answerable claim" from the chunks (or returns null); second pass writes the prose. Reduces fabrication risk further at the cost of one extra LLM call per ticket.
- **Different model grading drafts**: have Azure 4o-mini grade a Claude draft (or vice versa) instead of same-model self-grade. Reduces shared-model praise bias.
- **Better eval set**: 50+ tickets, sourced from Instantly's actual support inbox (anonymised), with human-labeled ground truth. The current 12 are illustrative; 50+ would let me publish per-category accuracy with real confidence intervals.
- **Multi-language support**: detect non-English tickets and either decline (route to human) or reply in language. Currently the system relies on Claude/4o-mini's native multilingual capability without explicit handling.
- **Multi-turn conversation handling**: this take-home only handles first-message classification. Production support requires reading the thread + customer's prior responses.
- **Cost per ticket dashboard widget**: live Azure + Anthropic spend per ticket, charted weekly. Currently you have to read it from logs.
- **Real send integration**: this build logs the would-be email but doesn't actually send. Wire to Resend / SES once a real ticketing source is plugged in.
- **A/B testing infrastructure for prompts**: route 10% of tickets through `prompt_draft_v2` and compare auto-send agreement, customer-reply rate, and reviewer-approval rate. Currently you just ship a new version and watch.
- **Embeddings fine-tuned on Instantly-specific vocabulary**: marginal gain at 18-doc KB; meaningful at 1000+ docs.

## Repo layout

```
.
├── README.md                 you are here
├── .env.example              full env documentation
├── supabase/schema.sql       schema, RPC, RLS, seeded settings
├── scripts/
│   ├── ingest_kb.js          Playwright + Azure embeddings → Supabase
│   ├── kb_urls.json          18 hand-picked URLs across 5 categories
│   └── package.json
├── prompts/
│   ├── classify.v1.md
│   ├── draft.v1.md
│   └── self_grade.v1.md
├── n8n/
│   ├── workflow-respond-ticket.json   17 nodes — main pipeline
│   ├── workflow-error-retry.json      10 nodes — retry on failure, max 3
│   ├── workflow-drain-pending.json    5 nodes  — every 10 min, restart stuck tickets
│   └── SETUP.md                       operator runbook for Mac Mini import
├── evals/
│   ├── tickets.json          12 hand-crafted cases, 2/category, with expected outcomes
│   ├── run.js                POSTs each, polls Supabase, prints results table + headline
│   └── package.json
└── dashboard/                Next.js + NextAuth (Google SSO) + Supabase + Tailwind
    └── src/
        ├── middleware.ts
        ├── lib/{auth.ts, supabase.ts, types.ts}
        ├── app/
        │   ├── page.tsx              /        — review queue
        │   ├── sent/page.tsx         /sent    — calibration view
        │   ├── tickets/[id]/page.tsx /tickets/<id> — full decision chain + actions
        │   ├── logs/page.tsx         /logs    — flat ticket_runs + CSV export
        │   ├── settings/page.tsx     /settings — live threshold sliders + n8n URL
        │   ├── auth/signin/page.tsx
        │   └── api/
        │       ├── auth/[...nextauth]/route.ts
        │       ├── tickets/route.ts                — GET list
        │       ├── tickets/[id]/route.ts           — GET detail + runs + history
        │       ├── tickets/[id]/action/route.ts    — POST approve/reject/edit_and_send
        │       ├── runs/route.ts                   — GET flat runs (logs)
        │       ├── settings/route.ts               — GET / PATCH
        │       ├── webhook/ticket-in/route.ts      — HMAC-verified inbound
        │       └── webhook/n8n-callback/route.ts   — x-n8n-token verified
        └── components/{Navbar, TicketTable, CategoryBadge, ConfidenceBadge, DecisionChain}.tsx
```

## License

Private — submitted as a take-home artifact.
