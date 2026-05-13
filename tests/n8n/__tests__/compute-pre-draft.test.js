import { describe, it, expect } from 'vitest';
import { run } from '../extracted/compute-pre-draft-decision.mjs';

function chunk({ id, sim, content = 'lorem ipsum '.repeat(100) }) {
  return {
    chunk_id: id,
    doc_url: 'https://help.example.com/' + id,
    doc_title: 'Doc ' + id,
    category: 'setup',
    section_heading: 'Heading ' + id,
    similarity: sim,
    content,
  };
}

function fixture({ classify_parse_error = null, settings = { hard_floor_top1_cosine: 0.45 }, chunks = [] }) {
  return {
    items: chunks,
    upstream: {
      'Parse Classification': [
        {
          ticket_id: 't-1',
          subject: 's',
          body: 'b',
          settings,
          classification: classify_parse_error
            ? null
            : { category: 'how_to_question', classification_confidence: 0.9 },
          classify_parse_error,
          classify_raw: 'whatever',
        },
      ],
    },
  };
}

describe('compute-pre-draft-decision', () => {
  it('short-circuits on classify parse error', () => {
    const out = run(fixture({ classify_parse_error: 'bad' })).json;
    expect(out.should_short_circuit).toBe(true);
    expect(out.short_circuit_verdict).toBe('error');
    expect(out.short_circuit_reason).toBe('malformed_llm_output_classify');
  });

  it('short-circuits when retrieval returns 0 chunks', () => {
    const out = run(fixture({ chunks: [] })).json;
    expect(out.should_short_circuit).toBe(true);
    expect(out.short_circuit_verdict).toBe('cannot_answer');
    expect(out.short_circuit_reason).toBe('no_kb_match');
  });

  it('short-circuits when top1 below hard_floor', () => {
    const out = run(
      fixture({
        chunks: [chunk({ id: 'c1', sim: 0.4 }), chunk({ id: 'c2', sim: 0.3 })],
      })
    ).json;
    expect(out.should_short_circuit).toBe(true);
    expect(out.short_circuit_verdict).toBe('cannot_answer');
    expect(out.short_circuit_reason).toMatch(/top1_below_hard_floor.*0\.400.*0\.45/);
  });

  it('does NOT short-circuit when top1 ≥ hard_floor', () => {
    const out = run(
      fixture({
        chunks: [chunk({ id: 'c1', sim: 0.7 }), chunk({ id: 'c2', sim: 0.6 })],
      })
    ).json;
    expect(out.should_short_circuit).toBe(false);
    expect(out.short_circuit_verdict).toBeNull();
    expect(out.top1).toBe(0.7);
    expect(out.top2).toBe(0.6);
    expect(out.margin).toBeCloseTo(0.1, 6);
  });

  it('normalizes top_chunks to {chunk_id, doc_url, doc_title, score, content_snippet}', () => {
    const out = run(
      fixture({
        chunks: [chunk({ id: 'c1', sim: 0.7, content: 'a'.repeat(800) })],
      })
    ).json;
    const c = out.top_chunks[0];
    expect(c.chunk_id).toBe('c1');
    expect(c.doc_url).toContain('c1');
    expect(c.score).toBe(0.7);
    expect(c.content_snippet).toHaveLength(500);
  });

  it('preserves top_chunks_full (raw rows for downstream prompt building)', () => {
    const out = run(
      fixture({
        chunks: [chunk({ id: 'c1', sim: 0.7 })],
      })
    ).json;
    expect(out.top_chunks_full[0].similarity).toBe(0.7);
    expect(out.top_chunks_full[0].content).toBeDefined();
  });

  it('uses default hard_floor (0.5) when settings missing', () => {
    const out = run(fixture({ settings: {}, chunks: [chunk({ id: 'c1', sim: 0.49 })] })).json;
    expect(out.should_short_circuit).toBe(true);
    expect(out.short_circuit_reason).toMatch(/0\.5/);
  });
});
