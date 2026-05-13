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

function req(qs = ''): Request {
  return new Request('http://localhost/api/tickets' + (qs ? '?' + qs : ''));
}

const sampleTickets = [
  { id: 't1', subject: 'A', status: 'human_review', created_at: '2026-05-12T00:00:00Z' },
  { id: 't2', subject: 'B', status: 'auto_sent', created_at: '2026-05-11T00:00:00Z' },
];
const sampleRuns = [
  {
    id: 'r1',
    ticket_id: 't1',
    classification: { category: 'how_to_question' },
    created_at: '2026-05-12T00:01:00Z',
  },
  {
    id: 'r2',
    ticket_id: 't2',
    classification: { category: 'billing' },
    created_at: '2026-05-11T00:01:00Z',
  },
];

function stage({ tickets = sampleTickets, runs = sampleRuns } = {}) {
  mockSb.setTable('tickets', { data: tickets, error: null } as MockResponse);
  mockSb.setTable('ticket_runs', { data: runs, error: null });
}

describe('GET /api/tickets', () => {
  it('returns tickets with their latest run attached', async () => {
    stage();
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tickets).toHaveLength(2);
    expect(json.tickets[0].latest_run.id).toBe('r1');
    expect(json.tickets[1].latest_run.id).toBe('r2');
  });

  it('forwards status filter to supabase via .in()', async () => {
    stage();
    await GET(req('status=human_review,auto_sent') as never);
    const inCall = mockSb.calls.find((c) => c.method === 'in' && c.table === 'tickets');
    expect(inCall).toBeDefined();
    expect(inCall!.args).toEqual(['status', ['human_review', 'auto_sent']]);
  });

  it('filters in-memory by category when ?category=', async () => {
    stage();
    const res = await GET(req('category=billing') as never);
    const json = await res.json();
    expect(json.tickets).toHaveLength(1);
    expect(json.tickets[0].id).toBe('t2');
  });

  it('returns empty list when no tickets', async () => {
    stage({ tickets: [] });
    const res = await GET(req() as never);
    expect(await res.json()).toEqual({ tickets: [] });
  });

  it('clamps limit to 500 max', async () => {
    stage();
    await GET(req('limit=999999') as never);
    const limitCall = mockSb.calls.find((c) => c.method === 'limit');
    expect(limitCall!.args[0]).toBe(500);
  });

  it('500s when supabase tickets query errors', async () => {
    mockSb.setTable('tickets', { data: null, error: { message: 'boom' } });
    const res = await GET(req() as never);
    expect(res.status).toBe(500);
  });
});
