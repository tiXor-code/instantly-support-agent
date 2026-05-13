import { describe, it, expect } from 'vitest';
import { run } from '../extracted/parse-classification.mjs';

function fixture({ raw, prev = {} }) {
  return {
    items: [{ choices: [{ message: { content: raw } }] }],
    upstream: {
      'Build Classify Prompt': [
        { ticket_id: 't-1', subject: 's', body: 'b', settings: {}, t0: Date.now(), ...prev },
      ],
    },
  };
}

describe('parse-classification', () => {
  it('parses clean JSON', () => {
    const out = run(
      fixture({
        raw: JSON.stringify({
          category: 'how_to_question',
          classification_confidence: 0.92,
          reasoning: 'asks how-to',
        }),
      })
    ).json;
    expect(out.classification.category).toBe('how_to_question');
    expect(out.classify_parse_error).toBeNull();
    expect(out.classify_raw).toContain('how_to_question');
  });

  it('strips ```json fences', () => {
    const fenced =
      '```json\n' +
      JSON.stringify({ category: 'billing', classification_confidence: 0.7, reasoning: '' }) +
      '\n```';
    const out = run(fixture({ raw: fenced })).json;
    expect(out.classification.category).toBe('billing');
    expect(out.classify_parse_error).toBeNull();
  });

  it('strips bare ``` fences (no language tag)', () => {
    const fenced =
      '```\n' +
      JSON.stringify({ category: 'other', classification_confidence: 0.3, reasoning: '' }) +
      '\n```';
    const out = run(fixture({ raw: fenced })).json;
    expect(out.classification.category).toBe('other');
  });

  it('captures parse errors without throwing', () => {
    const out = run(fixture({ raw: 'not json {{{' })).json;
    expect(out.classification).toBeNull();
    expect(out.classify_parse_error).toMatch(/JSON|parse|Unexpected/i);
    expect(out.classify_raw).toBe('not json {{{');
  });

  it('handles empty Azure response', () => {
    const out = run(fixture({ raw: '' })).json;
    expect(out.classification).toBeNull();
    expect(out.classify_parse_error).toBeTruthy();
  });

  it('propagates upstream context (ticket_id, settings, t0)', () => {
    const out = run(
      fixture({
        raw: JSON.stringify({
          category: 'how_to_question',
          classification_confidence: 1,
          reasoning: '',
        }),
        prev: { ticket_id: 't-99', settings: { cosine_floor: 0.6 } },
      })
    ).json;
    expect(out.ticket_id).toBe('t-99');
    expect(out.settings.cosine_floor).toBe(0.6);
  });
});
