import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type MockResponse } from '@/__tests__/helpers/mock-supabase';

const ref: { client: unknown; session: unknown } = { client: null, session: null };
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ref.client }));
vi.mock('@/lib/auth', () => ({
  auth: async () => ref.session,
}));

const { POST } = await import('../route');

let mockSb: ReturnType<typeof createMockSupabase>;
beforeEach(() => {
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
  ref.session = { user: { email: 'reviewer@x.com' } };
});

function actionReq(body: unknown): Request {
  return new Request('http://localhost/api/tickets/t1/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function stageTicket(status = 'human_review') {
  let n = 0;
  mockSb.setTable('tickets', {
    fn: () => {
      n++;
      // 1: lookup; 2+: update
      if (n === 1) return { data: { id: 't1', status }, error: null } as MockResponse;
      return { data: null, error: null };
    },
  });
  mockSb.setTable('ticket_status_history', { data: null, error: null });
  mockSb.setTable('ticket_runs', { data: null, error: null });
}

describe('POST /api/tickets/[id]/action', () => {
  it('rejects unauthenticated request with 401', async () => {
    ref.session = null;
    const res = await POST(actionReq({ action: 'approve' }) as never, makeParams('t1') as never);
    expect(res.status).toBe(401);
  });

  it('approve → status sent + history row "human:<email>"', async () => {
    stageTicket();
    const res = await POST(actionReq({ action: 'approve' }) as never, makeParams('t1') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'sent' });
    const updateRow = mockSb.calls.find(
      (c) => c.table === 'tickets' && c.method === 'update'
    )!.args[0] as Record<string, unknown>;
    expect(updateRow.status).toBe('sent');
    expect(updateRow.completed_at).toBeTypeOf('string');
    const historyRow = mockSb.calls.find(
      (c) => c.table === 'ticket_status_history' && c.method === 'insert'
    )!.args[0] as Record<string, unknown>;
    expect(historyRow.changed_by).toBe('human:reviewer@x.com');
    expect(historyRow.new_status).toBe('sent');
  });

  it('reject → status rejected', async () => {
    stageTicket();
    const res = await POST(actionReq({ action: 'reject' }) as never, makeParams('t1') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'rejected' });
  });

  it('edit_and_send + edited_response → new ticket_runs row inserted', async () => {
    stageTicket();
    const res = await POST(
      actionReq({ action: 'edit_and_send', edited_response: 'Edited reply.' }) as never,
      makeParams('t1') as never
    );
    expect(res.status).toBe(200);
    const runInsert = mockSb.calls.find(
      (c) => c.table === 'ticket_runs' && c.method === 'insert'
    );
    expect(runInsert).toBeDefined();
    const runRow = runInsert!.args[0] as Record<string, unknown>;
    expect(runRow.draft_response).toBe('Edited reply.');
    expect(runRow.auto_sent).toBe(false);
    expect(runRow.verdict_reason).toBe('human_edit:reviewer@x.com');
  });

  it('edit_and_send WITHOUT edited_response → status sent, no extra run row', async () => {
    stageTicket();
    const res = await POST(actionReq({ action: 'edit_and_send' }) as never, makeParams('t1') as never);
    expect(res.status).toBe(200);
    const runInsert = mockSb.calls.find(
      (c) => c.table === 'ticket_runs' && c.method === 'insert'
    );
    expect(runInsert).toBeUndefined();
  });

  it('rejects invalid action with 400', async () => {
    stageTicket();
    const res = await POST(actionReq({ action: 'fart' }) as never, makeParams('t1') as never);
    expect(res.status).toBe(400);
  });

  it('404 when ticket not found', async () => {
    mockSb.setTable('tickets', { data: null, error: null });
    const res = await POST(actionReq({ action: 'approve' }) as never, makeParams('nope') as never);
    expect(res.status).toBe(404);
  });
});
