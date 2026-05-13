import { describe, it, expect } from 'vitest';
import { run } from '../extracted/compute-verdict.mjs';

// Synthesize an "upstream" item that mirrors what Build Self-Grade Prompt
// would emit. Then call compute-verdict with the Azure self-grade response
// as the main input.
function makeFixture({
  top1 = 0.8,
  top2 = 0.7,
  margin = 0.1,
  cosineFloor = 0.6,
  cosineMargin = 0.01,
  sgFloor = 5,
  sg = { grounded_in_cited_doc: 5, directly_answers_question: 5, tone_appropriate: 5 },
  draft_parse_error = null,
  cannot_answer = false,
  cannot_answer_reason = null,
  draft_response = 'Here is the answer. Full guide: https://help.example.com/x',
  skip_self_grade = false,
  sgRaw = JSON.stringify({
    grounded_in_cited_doc: sg?.grounded_in_cited_doc,
    directly_answers_question: sg?.directly_answers_question,
    tone_appropriate: sg?.tone_appropriate,
    justification: 'fixture',
  }),
  ticket_id = 't-1',
} = {}) {
  const prev = {
    ticket_id,
    classification: { category: 'how_to_question', classification_confidence: 0.9 },
    top_chunks: [{ chunk_id: 'c1' }, { chunk_id: 'c2' }],
    top_chunks_full: [],
    cited_docs: [],
    draft_response,
    cited_doc_urls: ['https://help.example.com/x'],
    used_chunk_ids: ['c1'],
    cannot_answer,
    cannot_answer_reason,
    draft_parse_error,
    skip_self_grade,
    classify_raw: '{"category":"how_to_question"}',
    draft_raw: draft_response || '',
    settings: {
      cosine_floor: cosineFloor,
      cosine_margin: cosineMargin,
      self_grade_floor: sgFloor,
    },
    top1,
    top2,
    margin,
    t0: Date.now() - 1234,
  };
  return {
    items: [{ choices: [{ message: { content: sgRaw } }] }],
    upstream: { 'Build Self-Grade Prompt': [prev] },
  };
}

describe('compute-verdict — multi-signal gate truth table', () => {
  it('all pass → auto_send', () => {
    const out = run(makeFixture()).json;
    expect(out.verdict).toBe('auto_send');
    expect(out.verdict_reason).toMatch(/^cos=0\.800 mar=0\.100 sg=5$/);
  });

  it('top1 below cosine_floor → human_review (cosine_below_floor)', () => {
    const out = run(makeFixture({ top1: 0.5, top2: 0.4, margin: 0.1 })).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toMatch(/top1_cosine_below_floor/);
  });

  it('margin below cosine_margin → human_review (margin_below_floor)', () => {
    const out = run(makeFixture({ top1: 0.8, top2: 0.795, margin: 0.005 })).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toMatch(/margin_below_floor/);
  });

  it('self-grade min below sg_floor → human_review (self_grade_below_floor)', () => {
    const out = run(
      makeFixture({
        sg: { grounded_in_cited_doc: 4, directly_answers_question: 5, tone_appropriate: 5 },
      })
    ).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toMatch(/self_grade_below_floor.*min=4/);
  });

  it('directly_answers below sg_floor → human_review (self_grade_below_floor)', () => {
    const out = run(
      makeFixture({
        sg: { grounded_in_cited_doc: 5, directly_answers_question: 3, tone_appropriate: 5 },
      })
    ).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toMatch(/self_grade_below_floor.*min=3/);
  });

  it('draft parse error → human_review (malformed_llm_output_draft)', () => {
    const out = run(makeFixture({ draft_parse_error: 'bad JSON' })).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toBe('malformed_llm_output_draft');
  });

  it('self-grade parse error → human_review (malformed_llm_output_self_grade)', () => {
    const out = run(makeFixture({ sgRaw: 'not json at all' })).json;
    expect(out.verdict).toBe('human_review');
    expect(out.verdict_reason).toBe('malformed_llm_output_self_grade');
  });

  it('cannot_answer flag → cannot_answer (drafter_declined)', () => {
    const out = run(
      makeFixture({
        cannot_answer: true,
        cannot_answer_reason: 'feature existence not confirmed',
        skip_self_grade: true,
        sgRaw: '',
      })
    ).json;
    expect(out.verdict).toBe('cannot_answer');
    expect(out.verdict_reason).toBe('drafter_declined:feature existence not confirmed');
  });

  it('strips ```json fences from self-grade response', () => {
    const fenced =
      '```json\n' +
      JSON.stringify({
        grounded_in_cited_doc: 5,
        directly_answers_question: 5,
        tone_appropriate: 5,
        justification: 'fixture',
      }) +
      '\n```';
    const out = run(makeFixture({ sgRaw: fenced })).json;
    expect(out.verdict).toBe('auto_send');
  });

  it('latency_ms is positive and roughly matches t0', () => {
    const out = run(makeFixture()).json;
    expect(out.latency_ms).toBeGreaterThan(1000);
    expect(out.latency_ms).toBeLessThan(60_000);
  });

  it('threshold defaults are used when settings are missing', () => {
    // No settings on prev → defaults: cf=0.78, mar=0.05, sg=4
    const noSettings = makeFixture({
      top1: 0.79,
      top2: 0.7,
      margin: 0.09,
      sg: { grounded_in_cited_doc: 4, directly_answers_question: 4, tone_appropriate: 4 },
    });
    delete noSettings.upstream['Build Self-Grade Prompt'][0].settings;
    const out = run(noSettings).json;
    expect(out.verdict).toBe('auto_send');
  });

  it('preserves raw_llm_outputs for debugging on parse errors', () => {
    const out = run(makeFixture({ sgRaw: 'garbage' })).json;
    expect(out.raw_llm_outputs.self_grade_raw).toBe('garbage');
    expect(out.raw_llm_outputs.sg_parse_error).toBeTruthy();
  });

  it('passes ticket_id, classification, top_chunks through', () => {
    const out = run(makeFixture({ ticket_id: 't-42' })).json;
    expect(out.ticket_id).toBe('t-42');
    expect(out.classification.category).toBe('how_to_question');
    expect(out.top_chunks).toHaveLength(2);
  });

  it('emits prompt_versions stamp', () => {
    const out = run(makeFixture()).json;
    expect(out.prompt_versions).toMatchObject({
      classify: expect.any(String),
      draft: expect.any(String),
      self_grade: expect.any(String),
    });
  });
});
