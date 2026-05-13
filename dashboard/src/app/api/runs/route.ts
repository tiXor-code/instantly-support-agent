import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/runs?limit=200&verdict=auto_send,human_review
//
// Flat list of ticket_runs joined with ticket subject for the /logs view.
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000);
  const verdictParam = url.searchParams.get('verdict');

  let q = supabase
    .from('ticket_runs')
    .select('*, tickets!inner(subject, customer_email, status)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (verdictParam) {
    const verdicts = verdictParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (verdicts.length) q = q.in('verdict', verdicts);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
