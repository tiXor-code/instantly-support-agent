import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase } from '@/__tests__/helpers/mock-supabase';

const ref: { client: unknown } = { client: null };
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ref.client }));

const { GET } = await import('../route');

let mockSb: ReturnType<typeof createMockSupabase>;
beforeEach(() => {
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
});

function req(qs = ''): Request {
  return new Request('http://localhost/api/runs' + (qs ? '?' + qs : ''));
}

describe('GET /api/runs', () => {
  it('returns rows with default ordering and limit', async () => {
    mockSb.setTable('ticket_runs', {
      data: [{ id: 'r1' }, { id: 'r2' }],
      error: null,
    });
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs).toHaveLength(2);

    const order = mockSb.calls.find((c) => c.method === 'order');
    expect(order!.args).toEqual(['created_at', { ascending: false }]);
    const limit = mockSb.calls.find((c) => c.method === 'limit');
    expect(limit!.args[0]).toBe(200);
  });

  it('honors ?limit=', async () => {
    mockSb.setTable('ticket_runs', { data: [], error: null });
    await GET(req('limit=50') as never);
    const limit = mockSb.calls.find((c) => c.method === 'limit');
    expect(limit!.args[0]).toBe(50);
  });

  it('clamps limit to 1000', async () => {
    mockSb.setTable('ticket_runs', { data: [], error: null });
    await GET(req('limit=99999') as never);
    const limit = mockSb.calls.find((c) => c.method === 'limit');
    expect(limit!.args[0]).toBe(1000);
  });

  it('forwards verdict filter via .in()', async () => {
    mockSb.setTable('ticket_runs', { data: [], error: null });
    await GET(req('verdict=auto_send,human_review') as never);
    const inCall = mockSb.calls.find((c) => c.method === 'in');
    expect(inCall!.args).toEqual(['verdict', ['auto_send', 'human_review']]);
  });

  it('500s on supabase error', async () => {
    mockSb.setTable('ticket_runs', { data: null, error: { message: 'boom' } });
    const res = await GET(req() as never);
    expect(res.status).toBe(500);
  });
});
