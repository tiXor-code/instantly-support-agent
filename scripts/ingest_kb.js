#!/usr/bin/env node
// instantly-support-agent — knowledge-base ingester
//
// Reads scripts/kb_urls.json (18 hand-picked help.instantly.ai/en articles),
// scrapes each with Playwright, chunks paragraphs (~1000 token cap with 100
// token overlap), embeds with OpenAI text-embedding-3-small, and upserts
// kb_docs + kb_chunks in Supabase.
//
// Idempotent: re-running deletes existing chunks for each URL before
// re-inserting. Safe to interrupt and re-run.
//
// Required env (loaded from ../.env.local or ../.env):
//   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
//   AZURE_ISA_ENDPOINT       (e.g. https://instantly-support-agent-363fe.openai.azure.com/)
//   AZURE_ISA_KEY
//   AZURE_ISA_EMBED_DEPLOYMENT  (default: text-embedding-3-small)
//   AZURE_ISA_API_VERSION       (default: 2024-10-21)
//
// Run:  node ingest_kb.js
// Dry:  DRY_RUN=1 node ingest_kb.js   (scrape + chunk, no embed, no upsert)

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const HERE = dirname(fileURLToPath(import.meta.url));
// Load .env or .env.local from repo root if present
for (const envFile of ['.env.local', '.env']) {
  try {
    const txt = readFileSync(resolve(HERE, '..', envFile), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const AZURE_ENDPOINT = (process.env.AZURE_ISA_ENDPOINT || '').replace(/\/$/, '');
const AZURE_KEY = process.env.AZURE_ISA_KEY;
const AZURE_EMBED_DEPLOYMENT = process.env.AZURE_ISA_EMBED_DEPLOYMENT || 'text-embedding-3-small';
const AZURE_API_VERSION = process.env.AZURE_ISA_API_VERSION || '2024-10-21';
const DRY_RUN = process.env.DRY_RUN === '1';
const EMBED_DIMS = 1536; // text-embedding-3-small native

// Chunking heuristics. tiktoken-free: 4 chars ~ 1 token for English prose.
const MAX_CHUNK_CHARS = 4000;        // ~1000 tokens
const OVERLAP_CHARS   = 400;         // ~100 tokens

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service key. Set them in repo-root .env.local.');
  process.exit(1);
}
if (!DRY_RUN && (!AZURE_ENDPOINT || !AZURE_KEY)) {
  console.error('Missing AZURE_ISA_ENDPOINT / AZURE_ISA_KEY (required unless DRY_RUN=1).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const KB = JSON.parse(readFileSync(resolve(HERE, 'kb_urls.json'), 'utf8'));

// ----------------------------------------------------------------------------
// Scraping
// ----------------------------------------------------------------------------

async function scrapeOne(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Intercom-style help centers render the article body inside <article>.
  // Strip nav/footer/script/style before extracting text.
  const data = await page.evaluate(() => {
    const title =
      document.querySelector('h1')?.innerText?.trim() ||
      document.title?.replace(/ \| .+$/, '').trim() ||
      '';

    const article = document.querySelector('article') || document.body;
    // Remove non-content elements in-place
    article.querySelectorAll(
      'nav, header, footer, script, style, noscript, .intercom-h2b-button, button, .article-vote, .article-feedback'
    ).forEach((el) => el.remove());

    // Walk the article and emit a [{heading, paragraphs[]}] structure so we
    // can keep section_heading metadata per chunk.
    const sections = [];
    let cur = { heading: null, paragraphs: [] };
    sections.push(cur);
    for (const el of article.querySelectorAll('h1, h2, h3, h4, p, li, pre, code')) {
      const t = (el.innerText || '').trim();
      if (!t) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1') continue; // already captured as title
      if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
        cur = { heading: t, paragraphs: [] };
        sections.push(cur);
      } else {
        cur.paragraphs.push(t);
      }
    }
    // Intercom help-center articles render some content twice (a visible
    // <p> + an a11y/duplicate <li> inside step lists), so the same line
    // ends up in `paragraphs` twice in a row. Dedup consecutive duplicates
    // before downstream chunking — saves ~30% on chunk byte size and
    // cleans up the embedded text.
    for (const s of sections) {
      s.paragraphs = s.paragraphs.filter((p, i, a) => p !== a[i - 1]);
    }

    // Full plain-text content for kb_docs.content_md
    const content_md = sections
      .map((s) => (s.heading ? `\n## ${s.heading}\n\n` : '') + s.paragraphs.join('\n\n'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { title, sections, content_md };
  });
  return data;
}

// ----------------------------------------------------------------------------
// Chunking
// ----------------------------------------------------------------------------

function chunkSections(sections, docMeta) {
  const chunks = [];
  for (const sec of sections) {
    let buf = sec.heading ? `## ${sec.heading}\n\n` : '';
    for (const p of sec.paragraphs) {
      const candidate = buf + (buf ? '\n\n' : '') + p;
      if (candidate.length > MAX_CHUNK_CHARS && buf.trim()) {
        chunks.push({ section_heading: sec.heading, content: buf.trim() });
        buf = (sec.heading ? `## ${sec.heading}\n\n` : '') + buf.slice(-OVERLAP_CHARS) + '\n\n' + p;
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) chunks.push({ section_heading: sec.heading, content: buf.trim() });
  }
  // Drop empties + assign chunk_index
  return chunks
    .filter((c) => c.content.length >= 80)
    .map((c, i) => ({
      content: c.content,
      section_heading: c.section_heading,
      chunk_index: i,
      ...docMeta,
    }));
}

// ----------------------------------------------------------------------------
// Embedding
// ----------------------------------------------------------------------------

async function embedBatch(inputs) {
  // Azure OpenAI embeddings — same payload shape as OpenAI.com but
  // endpoint is /openai/deployments/<deployment>/embeddings with
  // ?api-version= and api-key header.
  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_EMBED_DEPLOYMENT}/embeddings?api-version=${AZURE_API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': AZURE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: inputs }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Azure embeddings ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`KB ingest starting. ${KB.urls.length} urls, DRY_RUN=${DRY_RUN}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) instantly-support-agent/0.1',
  });
  const page = await ctx.newPage();

  let docsOk = 0;
  let chunksTotal = 0;
  const errors = [];

  for (const { url, category } of KB.urls) {
    try {
      process.stdout.write(`  ${url} … `);
      const scraped = await scrapeOne(page, url);
      if (!scraped.title || !scraped.content_md || scraped.content_md.length < 200) {
        throw new Error(`thin content (${scraped.content_md.length} chars)`);
      }

      // Upsert kb_docs (replace existing row by URL)
      let doc_id;
      if (!DRY_RUN) {
        const { data: docRow, error: docErr } = await supabase
          .from('kb_docs')
          .upsert(
            {
              url,
              title: scraped.title,
              category,
              content_md: scraped.content_md,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: 'url' }
          )
          .select('id')
          .single();
        if (docErr) throw docErr;
        doc_id = docRow.id;

        // Delete existing chunks for this doc, then re-insert (idempotent re-ingest)
        await supabase.from('kb_chunks').delete().eq('doc_id', doc_id);
      }

      const chunks = chunkSections(scraped.sections, {
        category,
        doc_url: url,
        doc_title: scraped.title,
      });
      if (chunks.length === 0) throw new Error('no chunks produced');

      if (!DRY_RUN) {
        const embeddings = await embedBatch(chunks.map((c) => c.content));
        const rows = chunks.map((c, i) => ({
          doc_id,
          content: c.content,
          embedding: embeddings[i],
          category: c.category,
          doc_url: c.doc_url,
          doc_title: c.doc_title,
          section_heading: c.section_heading,
          chunk_index: c.chunk_index,
        }));
        const { error: chunkErr } = await supabase.from('kb_chunks').insert(rows);
        if (chunkErr) throw chunkErr;
      }

      docsOk += 1;
      chunksTotal += chunks.length;
      console.log(`ok (${chunks.length} chunks)`);
    } catch (err) {
      errors.push({ url, message: err.message });
      console.log(`FAIL — ${err.message}`);
    }
  }

  await browser.close();

  console.log('');
  console.log('=== summary ===');
  console.log(`docs ok:    ${docsOk}/${KB.urls.length}`);
  console.log(`chunks:     ${chunksTotal}`);
  console.log(`embed dims: ${EMBED_DIMS}`);
  if (errors.length) {
    console.log(`errors:     ${errors.length}`);
    for (const e of errors) console.log(`  - ${e.url}: ${e.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
