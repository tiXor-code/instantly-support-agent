# n8n setup runbook

Importing the three workflows into the existing Mac Mini n8n instance (the one that already runs ministeru-pipeline). Estimated time: 10 minutes.

## Prerequisites

- n8n running on the Mac Mini at `http://localhost:5678` (already true — ministeru-pipeline runs there)
- Cloudflare Tunnel `ministeru-n8n` already routing `n8n.ministeru.dev` → `localhost:5678`
- Claude CLI authed at `/Users/johnopenclaw/.local/bin/claude` (already true)
- Azure OpenAI resource `instantly-support-agent` provisioned with `gpt-4o-mini` + `text-embedding-3-small` deployments

## 1. Set Mac Mini env vars

The n8n workflows expect these env vars to be available to the n8n process:

```bash
# In ~/.config/n8n/.env (or wherever you've been setting them)
export SUPABASE_URL="https://gbakbzlkgdlhrnnckpoj.supabase.co"
export SUPABASE_SERVICE_KEY="<service_role key from Supabase dashboard>"

export AZURE_ISA_ENDPOINT="https://instantly-support-agent-363fe.openai.azure.com/"
export AZURE_ISA_KEY="<from az cognitiveservices account keys list>"
export AZURE_ISA_CHAT_DEPLOYMENT="gpt-4o-mini"
export AZURE_ISA_EMBED_DEPLOYMENT="text-embedding-3-small"
export AZURE_ISA_API_VERSION="2024-10-21"

export DASHBOARD_CALLBACK_URL="https://instantly-support-agent.vercel.app/api/webhook/n8n-callback"
export N8N_CALLBACK_SECRET="<must match Vercel env>"
```

Restart n8n after setting these so the workflows pick them up.

## 2. Import workflows

In the n8n UI:

1. **Workflows → Import → File** → select `n8n/workflow-respond-ticket.json`
2. Repeat for `workflow-error-retry.json` and `workflow-drain-pending.json`

n8n will warn that the placeholder URLs in the retry + drain workflows (`https://n8n.example.com/webhook/respond-ticket`) are external. After step 3 below, edit those nodes to point at the actual tunnel URL.

## 3. Activate the main workflow + grab its webhook URL

1. Open `Instantly Support Agent — Respond to Ticket`
2. Toggle the **Active** switch on
3. Click the `Webhook Trigger` node — copy the **Production URL**. Should look like: `https://n8n.ministeru.dev/webhook/respond-ticket`

## 4. Wire the retry + drain workflows

1. Open `Instantly Support Agent — Error Retry`. Edit the `Re-fire Respond-Ticket` node → set URL to the production webhook URL from step 3.
2. Open `Instantly Support Agent — Drain Pending Tickets`. Edit the `Re-fire Respond-Ticket` node → same.
3. Activate both workflows.

## 5. Tell the dashboard where n8n lives

Sign into https://instantly-support-agent.vercel.app/settings (must be in `ALLOWED_EMAILS`) and:

- Paste the production webhook URL from step 3 into **Webhook URL**
- Paste your `N8N_CALLBACK_SECRET` into **Callback shared secret**

Both save on blur.

## 6. Smoke test

```bash
SECRET=<your INBOUND_WEBHOOK_HMAC_SECRET>
BODY='{"external_id":"smoke-1","subject":"How do I add an unsubscribe link?","body":"Where do I configure this in the editor?","customer_email":"smoke@example.com"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -X POST https://instantly-support-agent.vercel.app/api/webhook/ticket-in \
  -H "x-instantly-signature: $SIG" \
  -H "content-type: application/json" \
  -d "$BODY"
```

Expected: `{"ticket_id":"...","deduped":false}` immediately, then watch n8n's Executions view for the workflow run, then `/sent` on the dashboard for the verdict (typical happy-path latency: 8-15s end-to-end).

## 7. Run the eval set

```bash
cd evals
npm install
DASHBOARD_BASE_URL=https://instantly-support-agent.vercel.app node run.js
```

Outputs a per-ticket table + auto-rate + per-category breakdown. The headline numbers fill into README §8.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Ticket sits in `processing` forever | Tunnel down or n8n inactive | Check `cloudflared tunnel info ministeru-n8n` and the workflow's Active toggle |
| `embed-query` step fails with 401 | `AZURE_ISA_KEY` wrong or expired | `az cognitiveservices account keys list -n instantly-support-agent -g ai-foundry` and update env |
| `Draft (Claude CLI)` step fails with "Keychain read failed" | Claude CLI logged out | Run `claude login` on the Mac Mini |
| Callback to dashboard returns 401 | `N8N_CALLBACK_SECRET` mismatch | Compare Vercel env vs Mac Mini env |
| All retrievals return similarity ~0.4 | KB not indexed | `cd scripts && node ingest_kb.js` |
