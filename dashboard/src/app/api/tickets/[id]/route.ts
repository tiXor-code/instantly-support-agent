import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/tickets/[id] — ticket + all runs (newest first) + status history
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [ticketRes, runsRes, historyRes] = await Promise.all([
    supabase.from('tickets').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('ticket_runs')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('ticket_status_history')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (ticketRes.error) {
    return NextResponse.json({ error: ticketRes.error.message }, { status: 500 });
  }
  if (!ticketRes.data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({
    ticket: ticketRes.data,
    runs: runsRes.data ?? [],
    history: historyRes.data ?? [],
  });
}
