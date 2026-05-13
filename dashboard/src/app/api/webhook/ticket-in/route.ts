import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase';

// POST /api/webhook/ticket-in
//
// Inbound webhook from the ticketing source (Front, Zendesk, or curl in
// the demo). Body:
//   { external_id?: string, subject: string, body: string, customer_email: string }
//
// Verifies HMAC of the raw body using INBOUND_WEBHOOK_HMAC_SECRET (header
// `x-instantly-signature` = sha256=<hex>), inserts the ticket idempotently
// by external_id, and fires a fire-and-forget POST to the n8n webhook URL
// stored in settings.n8n_webhook_url.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get('x-instantly-signature') || '';
  const secret = process.env.INBOUND_WEBHOOK_HMAC_SECRET || '';
  if (secret && !verifyHmac(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: { external_id?: string; subject?: string; body?: string; customer_email?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { external_id, subject, body, customer_email } = payload;
  if (!subject || !body || !customer_email) {
    return NextResponse.json(
      { error: 'subject, body, customer_email are required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Idempotency: if external_id was already received, return 200 with deduped flag
  if (external_id) {
    const { data: existing } = await supabase
      .from('tickets')
      .select('id')
      .eq('external_id', external_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ticket_id: existing.id, deduped: true });
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('tickets')
    .insert({
      external_id: external_id ?? null,
      subject,
      body,
      customer_email,
      status: 'processing',
    })
    .select('id')
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // status history entry
  await supabase.from('ticket_status_history').insert({
    ticket_id: inserted.id,
    old_status: null,
    new_status: 'processing',
    changed_by: 'webhook',
    notes: 'inbound ticket received',
  });

  // Fire-and-forget POST to n8n. We do not await the response — n8n will
  // call back to /api/webhook/n8n-callback with the verdict. If the
  // tunnel is down the workflow-drain-pending.json schedule will pick
  // this up within 10 minutes.
  const { data: settingRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'n8n_webhook_url')
    .maybeSingle();
  const n8nUrl = (settingRow?.value as string | undefined) || process.env.N8N_WEBHOOK_URL;

  if (n8nUrl) {
    // Awaited dispatch with a short timeout. Vercel serverless functions
    // tear down async work as soon as the response is returned, so a
    // pure fire-and-forget would never reach n8n. We give n8n 5s to
    // receive (n8n responds via Respond-to-Webhook before the workflow
    // finishes, so this is actually fast). If n8n is unreachable, the
    // ticket sits in 'processing' and workflow-drain-pending picks it
    // up on the next 10-min schedule tick.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(n8nUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticket_id: inserted.id,
          subject,
          body,
          customer_email,
        }),
        signal: controller.signal,
      });
    } catch {
      // drain workflow will retry
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json({ ticket_id: inserted.id, deduped: false });
}

function verifyHmac(rawBody: string, signatureHeader: string, secret: string): boolean {
  const match = signatureHeader.match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = match[1];
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}
