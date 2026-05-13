# instantly-support-agent

A support-ticket auto-responder for Instantly.ai built for the AI Automation Engineer take-home (Task B).

The system ingests incoming support tickets via webhook, classifies them, retrieves the most relevant articles from Instantly's public help center using vector search, drafts a cited response with Claude, and decides whether to auto-send or route to a human reviewer based on a **multi-signal confidence gate**. Every decision is logged with full chain-of-evidence.

> **Status:** scaffold. Full README (architecture, confidence design, tuning guide, eval analysis) will be filled out in Phase 8 of the build.

## Architecture

```
[webhook source] ──► /api/webhook/ticket-in (Vercel, HMAC-verified)
                          │
                          ▼ fire-and-forget POST via Cloudflare Tunnel
                  [Mac Mini n8n workflow]
                  classify → embed → retrieve → draft → self-grade → verdict
                          │
                          ▼ callback (x-n8n-token)
                  /api/webhook/n8n-callback ──► Supabase ──► Next.js dashboard
                                                              /queue /sent /logs /settings
```

## Layout

```
.
├── dashboard/            Next.js + NextAuth (Google SSO) + Supabase + Tailwind
├── supabase/             schema.sql (pgvector + HNSW)
├── scripts/              One-shot KB ingestion (Playwright + OpenAI embeddings)
├── prompts/              Versioned LLM prompts (classify, draft, self_grade)
├── n8n/                  Exported n8n workflow JSONs
├── evals/                Hand-crafted ticket eval set + run script
└── samples/              Sample inbound webhook payloads
```

## Quickstart (will be expanded)

```bash
# 1. Install
cd dashboard && npm install

# 2. Configure env
cp .env.example .env.local
# fill in Supabase, Google OAuth, Anthropic, OpenAI keys

# 3. Apply schema
# (via Supabase Studio SQL editor, or supabase CLI)

# 4. Ingest KB
node ../scripts/ingest_kb.js

# 5. Deploy dashboard
vercel

# 6. Import n8n workflows
# Open Mac Mini n8n UI, import n8n/*.json, set credentials, activate
```

## License

Private — submitted as a take-home artifact.
