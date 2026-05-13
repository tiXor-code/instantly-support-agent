// Pure chunking helpers, extracted from ingest_kb.js so they can be unit-tested.
//
// chunkSections takes the [{ heading, paragraphs[] }] structure produced by
// the scraper and returns chunk rows ready for embedding + insertion. Hard
// cap of MAX_CHUNK_CHARS per chunk (~1000 tokens at the 4-chars-per-token
// English heuristic) with OVERLAP_CHARS of overlap (~100 tokens) between
// adjacent chunks within the same section. Chunks under MIN_CHUNK_CHARS are
// dropped because they tend to be noisy boilerplate (e.g. lone "Continue
// reading" links).

export const MAX_CHUNK_CHARS = 4000;
export const OVERLAP_CHARS = 400;
export const MIN_CHUNK_CHARS = 80;

export function chunkSections(sections, docMeta = {}) {
  const chunks = [];
  for (const sec of sections) {
    let buf = sec.heading ? `## ${sec.heading}\n\n` : '';
    for (const p of sec.paragraphs) {
      const candidate = buf + (buf ? '\n\n' : '') + p;
      if (candidate.length > MAX_CHUNK_CHARS && buf.trim()) {
        chunks.push({ section_heading: sec.heading, content: buf.trim() });
        buf =
          (sec.heading ? `## ${sec.heading}\n\n` : '') +
          buf.slice(-OVERLAP_CHARS) +
          '\n\n' +
          p;
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) chunks.push({ section_heading: sec.heading, content: buf.trim() });
  }
  return chunks
    .filter((c) => c.content.length >= MIN_CHUNK_CHARS)
    .map((c, i) => ({
      content: c.content,
      section_heading: c.section_heading,
      chunk_index: i,
      ...docMeta,
    }));
}
