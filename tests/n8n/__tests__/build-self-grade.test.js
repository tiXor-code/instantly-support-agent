import { describe, it, expect } from 'vitest';
import { run } from '../extracted/build-self-grade-prompt.mjs';

function fixture(overrides = {}) {
  return {
    items: [
      {
        ticket_id: 't-1',
        subject: 'How do I connect Gmail?',
        body: 'I want to connect my inbox.',
        draft_response: 'Click Connect, choose Gmail, complete OAuth. Full guide: https://help.example.com/connect',
        cited_doc_urls: ['https://help.example.com/connect'],
        used_chunk_ids: ['c1'],
        cannot_answer: false,
        draft_parse_error: null,
        top_chunks_full: [
          {
            chunk_id: 'c1',
            similarity: 0.81,
            content: 'Click Connect, pick Gmail, finish OAuth.',
          },
        ],
        settings: {},
        ...overrides,
      },
    ],
  };
}

describe('build-self-grade-prompt', () => {
  it('skips when drafter set cannot_answer', () => {
    const out = run(fixture({ cannot_answer: true, draft_response: null })).json;
    expect(out.skip_self_grade).toBe(true);
    expect(out.sg_system).toBeUndefined();
  });

  it('skips when draft_parse_error set', () => {
    const out = run(fixture({ draft_parse_error: 'bad json', draft_response: null })).json;
    expect(out.skip_self_grade).toBe(true);
  });

  it('skips when draft_response is empty/null', () => {
    const out = run(fixture({ draft_response: null })).json;
    expect(out.skip_self_grade).toBe(true);
  });

  it('uses inline fallback prompt when settings missing', () => {
    const out = run(fixture({})).json;
    expect(out.sg_system).toContain('GROUNDED_IN_CITED_DOC');
    expect(out.sg_system).toContain('DIRECTLY_ANSWERS_QUESTION');
    expect(out.sg_system).toContain('TONE_APPROPRIATE');
  });

  it('uses settings.prompt_self_grade_v1 when set', () => {
    const out = run(fixture({ settings: { prompt_self_grade_v1: 'CUSTOM SG' } })).json;
    expect(out.sg_system).toBe('CUSTOM SG');
  });

  it('builds user message with ticket subject, body, chunks, draft, and metadata', () => {
    const out = run(fixture({})).json;
    expect(out.sg_user).toContain('Ticket subject: How do I connect Gmail?');
    expect(out.sg_user).toContain('Ticket body:\nI want to connect my inbox.');
    expect(out.sg_user).toContain('chunk_id=c1');
    expect(out.sg_user).toContain('similarity=0.810');
    expect(out.sg_user).toContain('Draft reply:');
    expect(out.sg_user).toContain('Cited doc URLs from drafter');
    expect(out.sg_user).toContain('Used chunk ids from drafter');
  });
});
