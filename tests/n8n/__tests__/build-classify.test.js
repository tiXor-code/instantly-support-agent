import { describe, it, expect } from 'vitest';
import { run } from '../extracted/build-classify-prompt.mjs';

function fixture({ settings = {}, body = { ticket_id: 't-1', subject: 's', body: 'b', customer_email: 'c@x.com' } }) {
  return {
    items: Object.entries(settings).map(([key, value]) => ({ key, value })),
    upstream: { 'Webhook Trigger': [{ body }] },
  };
}

describe('build-classify-prompt', () => {
  it('uses inline fallback prompt when settings.prompt_classify_v1 is unset', () => {
    const out = run(fixture({})).json;
    expect(out.classify_system).toContain('classify incoming support tickets');
    expect(out.classify_system).toContain('how_to_question');
    expect(out.classify_system).toContain('billing');
  });

  it('uses settings.prompt_classify_v1 when set', () => {
    const customPrompt = 'CUSTOM PROMPT vNEXT';
    const out = run(fixture({ settings: { prompt_classify_v1: customPrompt } })).json;
    expect(out.classify_system).toBe(customPrompt);
  });

  it('builds user message from subject + body', () => {
    const out = run(
      fixture({
        body: { ticket_id: 't-2', subject: 'Cannot connect inbox', body: 'Tried OAuth, got 403.', customer_email: 'a@b.com' },
      })
    ).json;
    expect(out.classify_user).toBe('Subject: Cannot connect inbox\n\nBody:\nTried OAuth, got 403.');
  });

  it('propagates ticket fields and stamps t0', () => {
    const before = Date.now();
    const out = run(fixture({})).json;
    const after = Date.now();
    expect(out.ticket_id).toBe('t-1');
    expect(out.subject).toBe('s');
    expect(out.body).toBe('b');
    expect(out.customer_email).toBe('c@x.com');
    expect(out.t0).toBeGreaterThanOrEqual(before);
    expect(out.t0).toBeLessThanOrEqual(after);
  });

  it('flattens settings array into byKey map', () => {
    const out = run(
      fixture({ settings: { cosine_floor: 0.6, self_grade_floor: 5 } })
    ).json;
    expect(out.settings.cosine_floor).toBe(0.6);
    expect(out.settings.self_grade_floor).toBe(5);
  });
});
