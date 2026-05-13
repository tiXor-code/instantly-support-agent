import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/tickets?status=human_review,auto_sent&category=how_to_question
//
// Returns tickets joined with their *latest* ticket_runs row so the
// queue UI has everything it needs in one round trip.
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const categoryParam = url.searchParams.get('category');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  // Pull the most recent run per ticket via a left join + window function
  // would be ideal, but Supabase JS doesn't expose that ergonomically.
  // Simpler approach: pull tickets, then batch-fetch latest run per id.
  let q = supabase
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (statusParam) {
    const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) q = q.in('status', statuses);
  }

  const { data: tickets, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ tickets: [] });
  }

  const ticketIds = tickets.map((t) => t.id);
  const { data: runs, error: runsErr } = await supabase
    .from('ticket_runs')
    .select('*')
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: false });
  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 });
  }

  const latestByTicket = new Map<string, (typeof runs)[number]>();
  for (const r of runs || []) {
    if (!latestByTicket.has(r.ticket_id)) latestByTicket.set(r.ticket_id, r);
  }

  let combined = tickets.map((t) => ({
    ...t,
    latest_run: latestByTicket.get(t.id) ?? null,
  }));

  if (categoryParam) {
    const cats = categoryParam.split(',').map((s) => s.trim());
    combined = combined.filter((row) =>
      row.latest_run?.classification?.category &&
      cats.includes(row.latest_run.classification.category)
    );
  }

  return NextResponse.json({ tickets: combined });
}
