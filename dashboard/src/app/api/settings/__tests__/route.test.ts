import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase } from '@/__tests__/helpers/mock-supabase';

const ref: { client: unknown } = { client: null };
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ref.client }));

const { GET, PATCH } = await import('../route');

let mockSb: ReturnType<typeof createMockSupabase>;
beforeEach(() => {
  mockSb = createMockSupabase();
  ref.client = mockSb.client;
});

function patchReq(body: unknown): Request {
  return new Request('http://localhost/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/settings', () => {
  it('returns flattened {key: value} from rows', async () => {
    mockSb.setTable('settings', {
      data: [
        { key: 'cosine_floor', value: 0.6 },
        { key: 'self_grade_floor', value: 5 },
        { key: 'n8n_webhook_url', value: 'https://x.com' },
      ],
      error: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { cosine_floor: 0.6, self_grade_floor: 5, n8n_webhook_url: 'https://x.com' },
    });
  });

  it('returns empty object when there are no rows', async () => {
    mockSb.setTable('settings', { data: [], error: null });
    const res = await GET();
    expect(await res.json()).toEqual({ settings: {} });
  });

  it('500s on supabase error', async () => {
    mockSb.setTable('settings', { data: null, error: { message: 'boom' } });
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/settings', () => {
  it('upserts each provided key/value pair', async () => {
    mockSb.setTable('settings', { data: null, error: null });
    const res = await PATCH(patchReq({ cosine_floor: 0.65, cosine_margin: 0.02 }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 2 });
    const upserts = mockSb.calls.filter((c) => c.method === 'upsert');
    expect(upserts).toHaveLength(1);
    const rows = upserts[0].args[0] as Array<{ key: string; value: unknown }>;
    expect(rows).toEqual([
      { key: 'cosine_floor', value: 0.65 },
      { key: 'cosine_margin', value: 0.02 },
    ]);
    expect(upserts[0].args[1]).toEqual({ onConflict: 'key' });
  });

  it('400 on empty body', async () => {
    const res = await PATCH(patchReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('500 on supabase error', async () => {
    mockSb.setTable('settings', { data: null, error: { message: 'boom' } });
    const res = await PATCH(patchReq({ cosine_floor: 0.6 }) as never);
    expect(res.status).toBe(500);
  });
});
