import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type MockResponse } from '@/__tests__/helpers/mock-supabase';

const ref: { client: unknown } = { client: null };
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ref.client }));

const { POST } = await import('../route');

const SECRET = 'cb-token';
let mockSb: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  process.env.N8N_CALLBACK_SECRET = SECRET;
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
});

function makeReq(body: unknown, token = SECRET): Request {
  return new Request('http://localhost/api/webhook/n8n-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-n8n-token': token },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function stageHappy(existingStatus = 'processing') {
  // tickets lookup → returns row; ticket_runs insert → ok; ticket update → ok; status_history insert → ok
  let n = 0;
  mockSb.setTable('tickets', {
    fn: () => {
      n++;
      // first call is the lookup .maybeSingle, subsequent is .update
      if (n === 1) return { data: { id: 'tkt-1', status: existingStatus }, error: null } as MockResponse;
      return { data: null, error: null };
    },
  });
  mockSb.setTable('ticket_runs', { data: null, error: null });
  mockSb.setTable('ticket_status_history', { data: null, error: null });
}

const baseBody = {
  ticket_id: 'tkt-1',
  classification: { category: 'how_to_question', classification_confidence: 0.9 },
  top_chunks: [],
  draft_response: 'Here is your answer.',
  cited_docs: [{ doc_url: 'https://help.example.com/x', doc_title: 'X' }],
  self_grade: { grounded_in_cited_doc: 5, directly_answers_question: 5, tone_appropriate: 5 },
  verdict: 'auto_send',
  verdict_reason: 'cos=0.80 mar=0.10 sg=5',
  latency_ms: 1234,
  prompt_versions: { classify: 'v1', draft: 'v1', self_grade: 'v1' },
};

describe('POST /api/webhook/n8n-callback', () => {
  it('rejects missing token with 401', async () => {
    const res = await POST(makeReq(baseBody, '') as never);
    expect(res.status).toBe(401);
  });

  it('rejects wrong token with 401', async () => {
    const res = await POST(makeReq(baseBody, 'nope') as never);
    expect(res.status).toBe(401);
  });

  it('verdict=auto_send → status auto_sent + run + history rows', async () => {
    stageHappy();
    const res = await POST(makeReq(baseBody) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'auto_sent' });

    const runInsert = mockSb.calls.find((c) => c.table === 'ticket_runs' && c.method === 'insert');
    expect(runInsert).toBeDefined();
    const runRow = (runInsert!.args[0] as Record<string, unknown>);
    expect(runRow.verdict).toBe('auto_send');
    expect(runRow.auto_sent).toBe(true);
    expect(runRow.latency_ms).toBe(1234);

    const ticketUpdate = mockSb.calls.find((c) => c.table === 'tickets' && c.method === 'update');
    expect(ticketUpdate).toBeDefined();
    const updateRow = ticketUpdate!.args[0] as Record<string, unknown>;
    expect(updateRow.status).toBe('auto_sent');
    expect(updateRow.completed_at).toBeTypeOf('string');

    const historyInsert = mockSb.calls.find(
      (c) => c.table === 'ticket_status_history' && c.method === 'insert'
    );
    const historyRow = historyInsert!.args[0] as Record<string, unknown>;
    expect(historyRow.changed_by).toBe('n8n');
    expect(historyRow.new_status).toBe('auto_sent');
  });

  it('verdict=human_review → status human_review, completed_at=null', async () => {
    stageHappy();
    const res = await POST(
      makeReq({ ...baseBody, verdict: 'human_review', verdict_reason: 'low cosine' }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'human_review' });
    const updateRow = mockSb.calls.find(
      (c) => c.table === 'tickets' && c.method === 'update'
    )!.args[0] as Record<string, unknown>;
    expect(updateRow.status).toBe('human_review');
    expect(updateRow.completed_at).toBeNull();
  });

  it('verdict=cannot_answer → status human_review (still goes to queue)', async () => {
    stageHappy();
    const res = await POST(makeReq({ ...baseBody, verdict: 'cannot_answer' }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'human_review' });
  });

  it('verdict=error → status error', async () => {
    stageHappy();
    const res = await POST(makeReq({ ...baseBody, verdict: 'error' }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'error' });
  });

  it('returns 404 when ticket_id does not exist', async () => {
    mockSb.setTable('tickets', { data: null, error: null });
    const res = await POST(makeReq(baseBody) as never);
    expect(res.status).toBe(404);
  });

  it('returns 400 when ticket_id missing in body', async () => {
    stageHappy();
    const res = await POST(makeReq({ ...baseBody, ticket_id: undefined }) as never);
    expect(res.status).toBe(400);
  });

  it('preserves raw_llm_outputs in ticket_runs row', async () => {
    stageHappy();
    const raw = { classify_raw: '{}', draft_raw: 'oops', sg_parse_error: 'bad json' };
    await POST(makeReq({ ...baseBody, raw_llm_outputs: raw }) as never);
    const runRow = mockSb.calls.find(
      (c) => c.table === 'ticket_runs' && c.method === 'insert'
    )!.args[0] as Record<string, unknown>;
    expect(runRow.raw_llm_outputs).toEqual(raw);
  });
});
