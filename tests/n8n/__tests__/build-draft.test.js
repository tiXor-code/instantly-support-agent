import { describe, it, expect } from 'vitest';
import { run } from '../extracted/build-draft-prompt.mjs';

function fixture({ category = 'how_to_question', settings = {}, chunks = [] }) {
  return {
    items: [
      {
        ticket_id: 't-1',
        subject: 'How do I connect my inbox?',
        body: 'I want to connect Gmail.',
        classification: { category, classification_confidence: 0.9 },
        top_chunks_full: chunks,
        settings,
      },
    ],
  };
}

const sampleChunks = [
  {
    chunk_id: 'c1',
    similarity: 0.81,
    doc_url: 'https://help.example.com/connect-gmail',
    section_heading: 'Steps',
    content: 'Click Connect, choose Gmail, complete OAuth.',
  },
  {
    chunk_id: 'c2',
    similarity: 0.74,
    doc_url: 'https://help.example.com/oauth-troubleshooting',
    section_heading: 'Troubleshooting',
    content: 'If OAuth returns 403, revoke and retry.',
  },
];

describe('build-draft-prompt', () => {
  it('uses inline fallback draft prompt when settings missing', () => {
    const out = run(fixture({ chunks: sampleChunks })).json;
    expect(out.draft_system).toContain('Instantly.ai support agent');
    expect(out.draft_system).toContain('account_issue: ALWAYS cannot_answer');
    expect(out.draft_system).toContain('billing');
    expect(out.draft_system).toContain('Full guide');
  });

  it('uses settings.prompt_draft_v1 when set', () => {
    const out = run(
      fixture({ settings: { prompt_draft_v1: 'CUSTOM DRAFT PROMPT' }, chunks: sampleChunks })
    ).json;
    expect(out.draft_system).toBe('CUSTOM DRAFT PROMPT');
  });

  it('formats chunks with chunk_id, similarity, doc_url, section', () => {
    const out = run(fixture({ chunks: sampleChunks })).json;
    expect(out.draft_user).toContain('chunk_id=c1');
    expect(out.draft_user).toContain('similarity=0.810');
    expect(out.draft_user).toContain('doc_url=https://help.example.com/connect-gmail');
    expect(out.draft_user).toContain('section="Steps"');
  });

  it('includes the predicted category in the user message', () => {
    const out = run(fixture({ category: 'billing', chunks: sampleChunks })).json;
    expect(out.draft_user).toContain('Predicted category: billing');
  });

  it('falls back to category="other" when classification missing', () => {
    const out = run(
      fixture({ chunks: sampleChunks })
    );
    out.json.classification = null;
    // Re-run: when classification is null, builder uses 'other'
    const items = [{ ...out.json, classification: null }];
    const re = run({ items }).json;
    expect(re.draft_user).toMatch(/Predicted category: other/);
  });

  it('composes full_prompt as system + --- + user', () => {
    const out = run(fixture({ chunks: sampleChunks })).json;
    expect(out.draft_full_prompt).toContain(out.draft_system);
    expect(out.draft_full_prompt).toContain('---');
    expect(out.draft_full_prompt).toContain(out.draft_user);
  });

  it('handles empty chunk list (still composes a prompt)', () => {
    const out = run(fixture({ chunks: [] })).json;
    expect(out.draft_user).toContain('top 0');
    expect(out.draft_full_prompt).toBeDefined();
  });
});
