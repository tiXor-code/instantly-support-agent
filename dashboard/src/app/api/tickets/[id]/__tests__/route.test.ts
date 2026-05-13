import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type MockResponse } from '@/__tests__/helpers/mock-supabase';

const ref: { client: unknown } = { client: null };
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ref.client }));

const { GET } = await import('../route');

let mockSb: ReturnType<typeof createMockSupabase>;
beforeEach(() => {
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
});

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/tickets/[id]', () => {
  it('returns ticket + runs + history', async () => {
    const tableCall: Record<string, MockResponse> = {
      tickets: { data: { id: 't1', subject: 'A' }, error: null },
      ticket_runs: { data: [{ id: 'r1' }, { id: 'r2' }], error: null },
      ticket_status_history: { data: [{ id: 'h1' }], error: null },
    };
    for (const [t, r] of Object.entries(tableCall)) mockSb.setTable(t, r);

    const res = await GET(new Request('http://x') as never, makeParams('t1') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket.id).toBe('t1');
    expect(json.runs).toHaveLength(2);
    expect(json.history).toHaveLength(1);
  });

  it('404 when ticket missing', async () => {
    mockSb.setTable('tickets', { data: null, error: null });
    mockSb.setTable('ticket_runs', { data: [], error: null });
    mockSb.setTable('ticket_status_history', { data: [], error: null });
    const res = await GET(new Request('http://x') as never, makeParams('nope') as never);
    expect(res.status).toBe(404);
  });

  it('500 on supabase ticket lookup error', async () => {
    mockSb.setTable('tickets', { data: null, error: { message: 'boom' } });
    mockSb.setTable('ticket_runs', { data: [], error: null });
    mockSb.setTable('ticket_status_history', { data: [], error: null });
    const res = await GET(new Request('http://x') as never, makeParams('t1') as never);
    expect(res.status).toBe(500);
  });
});
