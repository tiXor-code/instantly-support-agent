import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createMockSupabase, type MockResponse } from '@/__tests__/helpers/mock-supabase';

// Hold a mutable ref so the vi.mock factory can read whichever client we
// install in beforeEach. vi.mock is hoisted to the top of the file, so we
// can't capture a closure over a beforeEach-scoped variable directly.
const ref: { client: unknown } = { client: null };

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ref.client,
}));

const { POST } = await import('../route');

const SECRET = 'test-hmac-secret';

let mockSb: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  process.env.INBOUND_WEBHOOK_HMAC_SECRET = SECRET;
  process.env.N8N_WEBHOOK_URL = 'https://n8n.example.com/webhook/respond-ticket';
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
  vi.unstubAllGlobals();
});

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function makeReq(
  body: object,
  { signature, method = 'POST' }: { signature?: string; method?: string } = {}
): Request {
  const raw = JSON.stringify(body);
  const sig = signature ?? sign(raw);
  return new Request('http://localhost/api/webhook/ticket-in', {
    method,
    headers: { 'content-type': 'application/json', 'x-instantly-signature': sig },
    body: raw,
  });
}

// Stage table responses so the dedup lookup misses, then the insert returns a row.
function stageInsertHappy(ticketId = 'tkt-123') {
  let n = 0;
  mockSb.setTable('tickets', {
    fn: () => {
      n++;
      // call 1: dedup lookup (no row found) — only happens if external_id is set
      // call 2: insert ... select single → returns the new row
      if (n === 1) return { data: null, error: null } as MockResponse;
      return { data: { id: ticketId }, error: null };
    },
  });
}

function stageInsertHappyNoExternal(ticketId = 'tkt-123') {
  // No external_id → no dedup lookup, only the insert.
  mockSb.setTable('tickets', { data: { id: ticketId }, error: null });
}

describe('POST /api/webhook/ticket-in', () => {
  it('rejects bad HMAC with 401 and does not write to DB', async () => {
    stageInsertHappyNoExternal();
    const req = makeReq(
      { subject: 's', body: 'b', customer_email: 'a@b.com' },
      { signature: 'sha256=deadbeef' }
    );
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    expect(mockSb.calls.find((c) => c.method === 'insert')).toBeUndefined();
  });

  it('rejects missing required fields with 400', async () => {
    const req = makeReq({ subject: 'only-subject' });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/);
  });

  it('happy path: inserts ticket, fires n8n, returns ticket_id', async () => {
    stageInsertHappyNoExternal('tkt-123');
    mockSb.setTable('settings', {
      data: { value: 'https://n8n.example.com/webhook/respond-ticket' },
      error: null,
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = { subject: 'Hi', body: 'Question', customer_email: 'q@x.com' };
    const res = await POST(makeReq(payload) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket_id: 'tkt-123', deduped: false });

    const inserts = mockSb.calls.filter((c) => c.method === 'insert');
    expect(inserts.length).toBeGreaterThanOrEqual(2); // tickets + status_history
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://n8n.example.com/webhook/respond-ticket');
    const sentBody = JSON.parse(call[1].body as string);
    expect(sentBody.ticket_id).toBe('tkt-123');
    expect(sentBody.subject).toBe('Hi');
  });

  it('replay (existing external_id) returns deduped=true and skips insert + n8n', async () => {
    mockSb.setTable('tickets', { data: { id: 'tkt-existing' }, error: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      makeReq({
        external_id: 'ext-1',
        subject: 's',
        body: 'b',
        customer_email: 'a@b.com',
      }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket_id: 'tkt-existing', deduped: true });
    expect(fetchMock).not.toHaveBeenCalled();
    const inserts = mockSb.calls.filter((c) => c.method === 'insert');
    expect(inserts).toHaveLength(0);
  });

  it('n8n unreachable: ticket still inserted, returns 200', async () => {
    stageInsertHappy('tkt-new');
    mockSb.setTable('settings', { data: { value: 'https://unreachable.example.com' }, error: null });
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      makeReq({
        external_id: 'ext-new',
        subject: 's',
        body: 'b',
        customer_email: 'a@b.com',
      }) as never
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket_id).toBe('tkt-new');
    expect(json.deduped).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('handles UTF-8 bodies with non-ASCII chars', async () => {
    stageInsertHappyNoExternal('tkt-utf');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(
      makeReq({
        subject: 'Probléme — déjà vu 🚀',
        body: 'Hilfe! 助けて',
        customer_email: 'a@b.com',
      }) as never
    );
    expect(res.status).toBe(200);
  });

  it('rejects non-JSON body with 400', async () => {
    const raw = 'not json';
    const req = new Request('http://localhost/api/webhook/ticket-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-instantly-signature': sign(raw),
      },
      body: raw,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
