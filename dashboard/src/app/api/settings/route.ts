import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/settings — returns all settings as { key: value }
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return NextResponse.json({ settings: out });
}

// PATCH /api/settings — body: { key1: value1, key2: value2 }
// Each key/value pair is upserted into the settings table.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const entries = Object.entries(body || {});
  if (entries.length === 0) {
    return NextResponse.json({ error: 'no keys to update' }, { status: 400 });
  }
  const supabase = createServiceClient();
  const rows = entries.map(([key, value]) => ({ key, value }));
  const { error } = await supabase
    .from('settings')
    .upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: entries.length });
}
