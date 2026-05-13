import { describe, it, expect } from 'vitest';
import { run } from '../extracted/build-short-circuit-callback.mjs';

describe('build-short-circuit-callback', () => {
  it('emits cannot_answer payload with no draft / no self-grade', () => {
    const out = run({
      items: [
        {
          ticket_id: 't-1',
          classification: { category: 'how_to_question' },
          top_chunks: [{ chunk_id: 'c1' }],
          short_circuit_verdict: 'cannot_answer',
          short_circuit_reason: 'top1_below_hard_floor (0.40 < 0.45)',
          classify_raw: '{}',
          classify_parse_error: null,
          t0: Date.now() - 500,
        },
      ],
    }).json;
    expect(out.verdict).toBe('cannot_answer');
    expect(out.verdict_reason).toMatch(/top1_below_hard_floor/);
    expect(out.draft_response).toBeNull();
    expect(out.self_grade).toBeNull();
    expect(out.cited_docs).toEqual([]);
    expect(out.latency_ms).toBeGreaterThanOrEqual(500);
  });

  it('emits error payload when classify failed', () => {
    const out = run({
      items: [
        {
          ticket_id: 't-2',
          classification: null,
          top_chunks: [],
          short_circuit_verdict: 'error',
          short_circuit_reason: 'malformed_llm_output_classify',
          classify_raw: 'garbage',
          classify_parse_error: 'Unexpected token',
          t0: Date.now(),
        },
      ],
    }).json;
    expect(out.verdict).toBe('error');
    expect(out.verdict_reason).toBe('malformed_llm_output_classify');
    expect(out.raw_llm_outputs.classify_raw).toBe('garbage');
    expect(out.raw_llm_outputs.classify_parse_error).toBe('Unexpected token');
  });

  it('falls back to "error" / "unspecified" when fields missing', () => {
    const out = run({ items: [{ ticket_id: 't-3', t0: Date.now() }] }).json;
    expect(out.verdict).toBe('error');
    expect(out.verdict_reason).toBe('unspecified');
  });

  it('always omits draft + self_grade prompt versions in short-circuit', () => {
    const out = run({
      items: [{ ticket_id: 't-4', t0: Date.now(), short_circuit_verdict: 'cannot_answer' }],
    }).json;
    expect(out.prompt_versions.draft).toBeNull();
    expect(out.prompt_versions.self_grade).toBeNull();
  });
});
