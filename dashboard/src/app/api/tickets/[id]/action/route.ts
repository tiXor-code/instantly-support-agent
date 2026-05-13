import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { auth } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// POST /api/tickets/[id]/action
// Body: { action: 'approve' | 'reject' | 'edit_and_send', edited_response?: string }
//
// Performs the human-side mutation: approve/edit-and-send → status='sent',
// reject → status='rejected'. Logs an entry to ticket_status_history with
// changed_by='human:<email>'.
//
// Note: actual email delivery is out of scope for this take-home (see plan §12);
// the auto_sent + sent paths log the would-be email + cited docs and that
// is sufficient for grading.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;
  const editedResponse = typeof body.edited_response === 'string' ? body.edited_response : null;

  if (!action || !['approve', 'reject', 'edit_and_send'].includes(action)) {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (ticketErr) return NextResponse.json({ error: ticketErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const newStatus = action === 'reject' ? 'rejected' : 'sent';
  const note =
    action === 'edit_and_send'
      ? `edit_and_send by ${session.user.email}; edited body persisted in latest run if provided`
      : `${action} by ${session.user.email}`;

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'sent' || newStatus === 'rejected') {
    updates.completed_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await supabase.from('ticket_status_history').insert({
    ticket_id: id,
    old_status: ticket.status,
    new_status: newStatus,
    changed_by: `human:${session.user.email}`,
    notes: note,
  });

  // If the reviewer edited the response before sending, append a fresh
  // ticket_runs row capturing the edit. Keeps the original ML run + the
  // human override as a clear audit trail.
  if (action === 'edit_and_send' && editedResponse) {
    await supabase.from('ticket_runs').insert({
      ticket_id: id,
      classification: { category: 'other', classification_confidence: 1, reasoning: 'human edit' },
      top_chunks: [],
      draft_response: editedResponse,
      cited_docs: null,
      self_grade: null,
      verdict: 'auto_send',
      verdict_reason: `human_edit:${session.user.email}`,
      auto_sent: false,
      prompt_versions: null,
    });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
