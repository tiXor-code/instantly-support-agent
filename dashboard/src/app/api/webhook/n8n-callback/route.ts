import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// POST /api/webhook/n8n-callback
//
// Called by the respond-ticket n8n workflow once the verdict is computed.
// Header: x-n8n-token = N8N_CALLBACK_SECRET (shared)
//
// Body:
// {
//   ticket_id: uuid,
//   classification: { category, classification_confidence, reasoning },
//   top_chunks: [{ chunk_id, doc_url, doc_title, similarity, content_snippet, category }, ...],
//   draft_response: string | null,
//   cited_docs: [{ doc_url, doc_title }, ...] | null,
//   self_grade: { grounded_in_cited_doc, directly_answers_question, tone_appropriate, justification } | null,
//   verdict: 'auto_send' | 'human_review' | 'cannot_answer' | 'error',
//   verdict_reason: string,
//   latency_ms: number | null,
//   prompt_versions: { classify, draft, self_grade } | null,
//   raw_llm_outputs?: object  // populated when a parse failed
// }
export async function POST(req: NextRequest) {
  const expected = process.env.N8N_CALLBACK_SECRET;
  const provided = req.headers.get('x-n8n-token') || '';
  if (expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const ticketId = body.ticket_id as string;
  if (!ticketId) {
    return NextResponse.json({ error: 'ticket_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: existing, error: lookupErr } = await supabase
    .from('tickets')
    .select('id, status')
    .eq('id', ticketId)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });

  const verdict = body.verdict as string;
  const autoSent = verdict === 'auto_send';
  const newStatus =
    verdict === 'auto_send'
      ? 'auto_sent'
      : verdict === 'error'
      ? 'error'
      : 'human_review';

  // Insert the run row first so we never lose decision data even if the
  // ticket update fails.
  const { error: runErr } = await supabase.from('ticket_runs').insert({
    ticket_id: ticketId,
    classification: body.classification ?? {},
    top_chunks: body.top_chunks ?? [],
    draft_response: body.draft_response ?? null,
    cited_docs: body.cited_docs ?? null,
    self_grade: body.self_grade ?? null,
    verdict,
    verdict_reason: (body.verdict_reason as string) || 'unspecified',
    auto_sent: autoSent,
    latency_ms: typeof body.latency_ms === 'number' ? body.latency_ms : null,
    prompt_versions: body.prompt_versions ?? null,
    raw_llm_outputs: body.raw_llm_outputs ?? null,
  });
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });

  const { error: tErr } = await supabase
    .from('tickets')
    .update({
      status: newStatus,
      completed_at: autoSent ? new Date().toISOString() : null,
    })
    .eq('id', ticketId);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  await supabase.from('ticket_status_history').insert({
    ticket_id: ticketId,
    old_status: existing.status,
    new_status: newStatus,
    changed_by: 'n8n',
    notes: `verdict=${verdict} reason=${body.verdict_reason ?? ''}`,
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
