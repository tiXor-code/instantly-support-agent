import { describe, it, expect } from 'vitest';
import {
  chunkSections,
  MAX_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  OVERLAP_CHARS,
} from '../lib/chunk.js';

const docMeta = {
  category: 'setup',
  doc_url: 'https://help.example.com/article-1',
  doc_title: 'How to Connect Your Inbox',
};

function pad(label, len) {
  return label + ' '.repeat(Math.max(0, len - label.length));
}

describe('chunkSections', () => {
  it('returns [] for empty sections', () => {
    expect(chunkSections([], docMeta)).toEqual([]);
  });

  it('produces one chunk for one small (but >MIN) section', () => {
    const para =
      'Open the dashboard, click Connect, and pick the email provider you want to authenticate. ' +
      'The OAuth flow will redirect you back when complete.';
    const out = chunkSections(
      [{ heading: 'Step 1', paragraphs: [para] }],
      docMeta
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      section_heading: 'Step 1',
      chunk_index: 0,
      ...docMeta,
    });
    expect(out[0].content).toContain('## Step 1');
    expect(out[0].content).toContain('Open the dashboard');
  });

  it('drops chunks under MIN_CHUNK_CHARS', () => {
    // A heading-less section with a tiny paragraph yields a sub-80-char chunk.
    const out = chunkSections([{ heading: null, paragraphs: ['too short'] }], docMeta);
    expect(out).toEqual([]);
  });

  it('splits when a section exceeds MAX_CHUNK_CHARS, with overlap', () => {
    // 3 paragraphs that each individually fit but together exceed the cap.
    const big = pad('para', Math.floor(MAX_CHUNK_CHARS * 0.6));
    const out = chunkSections(
      [{ heading: 'Big', paragraphs: [big, big, big] }],
      docMeta
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    // Overlap: each non-first chunk should include some bytes from the previous chunk's tail.
    for (let i = 1; i < out.length; i++) {
      const prevTail = out[i - 1].content.slice(-OVERLAP_CHARS / 2);
      expect(out[i].content).toContain(prevTail.slice(0, 50));
    }
    // Section heading propagates to every chunk in the section.
    for (const c of out) expect(c.section_heading).toBe('Big');
  });

  it('assigns chunk_index sequentially across all sections', () => {
    const out = chunkSections(
      [
        { heading: 'A', paragraphs: ['one '.repeat(50)] },
        { heading: 'B', paragraphs: ['two '.repeat(50)] },
        { heading: 'C', paragraphs: ['three '.repeat(50)] },
      ],
      docMeta
    );
    expect(out.map((c) => c.chunk_index)).toEqual([0, 1, 2]);
  });

  it('propagates docMeta into every chunk', () => {
    const out = chunkSections(
      [{ heading: 'X', paragraphs: ['lorem '.repeat(50)] }],
      docMeta
    );
    for (const c of out) {
      expect(c.category).toBe(docMeta.category);
      expect(c.doc_url).toBe(docMeta.doc_url);
      expect(c.doc_title).toBe(docMeta.doc_title);
    }
  });

  it('handles sections with null heading', () => {
    const out = chunkSections(
      [{ heading: null, paragraphs: ['No heading here. '.repeat(30)] }],
      docMeta
    );
    expect(out).toHaveLength(1);
    expect(out[0].section_heading).toBeNull();
    expect(out[0].content.startsWith('## ')).toBe(false);
  });

  it('keeps chunk content trimmed', () => {
    const out = chunkSections(
      [{ heading: 'X', paragraphs: ['hello world '.repeat(30)] }],
      docMeta
    );
    for (const c of out) {
      expect(c.content).toBe(c.content.trim());
      expect(c.content.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS);
    }
  });
});
