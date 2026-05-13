'use client';

import type { TicketRun, TopChunk } from '@/lib/types';
import CategoryBadge from './CategoryBadge';

export default function DecisionChain({ run }: { run: TicketRun }) {
  return (
    <div className="space-y-6">
      <Section title="1. Classification">
        <div className="flex items-center gap-3 mb-2">
          <CategoryBadge category={run.classification.category} />
          <span className="text-xs font-mono text-gray-600">
            confidence {run.classification.classification_confidence?.toFixed?.(2) ?? '—'}
          </span>
        </div>
        <Quote>{run.classification.reasoning}</Quote>
      </Section>

      <Section title="2. Retrieved chunks">
        {run.top_chunks?.length ? (
          <ol className="space-y-2">
            {run.top_chunks.map((c, i) => (
              <ChunkRow key={c.chunk_id ?? i} chunk={c} rank={i + 1} />
            ))}
          </ol>
        ) : (
          <Empty>No chunks retrieved.</Empty>
        )}
      </Section>

      <Section title="3. Draft response">
        {run.draft_response ? (
          <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-sm whitespace-pre-wrap font-sans">
            {run.draft_response}
          </pre>
        ) : (
          <Empty>No draft produced (drafter returned cannot_answer or short-circuited).</Empty>
        )}
        {run.cited_docs?.length ? (
          <div className="mt-3 text-xs text-gray-600">
            Cited:
            <ul className="list-disc ml-5 mt-1">
              {run.cited_docs.map((d) => (
                <li key={d.doc_url}>
                  <a className="text-sky-700 hover:underline" href={d.doc_url} target="_blank" rel="noreferrer">
                    {d.doc_title || d.doc_url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="4. Self-grade">
        {run.self_grade ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Score label="Grounded" value={run.self_grade.grounded_in_cited_doc} />
              <Score label="Directly answers" value={run.self_grade.directly_answers_question} />
              <Score label="Tone" value={run.self_grade.tone_appropriate} />
            </div>
            <Quote>{run.self_grade.justification}</Quote>
          </div>
        ) : (
          <Empty>No self-grade (drafter short-circuited).</Empty>
        )}
      </Section>

      <Section title="5. Verdict">
        <div className="flex items-center gap-3">
          <VerdictPill verdict={run.verdict} />
          <span className="text-sm text-gray-700 font-mono">{run.verdict_reason}</span>
        </div>
        {run.latency_ms != null && (
          <div className="text-xs text-gray-500 mt-2">
            latency {run.latency_ms} ms · prompts{' '}
            {run.prompt_versions
              ? Object.entries(run.prompt_versions)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')
              : '—'}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-gray-700 italic border-l-2 border-gray-200 pl-3">{children}</p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}

function Score({ label, value }: { label: string; value: number }) {
  const colour =
    value >= 4 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : value >= 3 ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-rose-50 border-rose-200 text-rose-700';
  return (
    <div className={`border rounded p-2 text-center ${colour}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-bold font-mono">{value}/5</div>
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const colour =
    verdict === 'auto_send'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : verdict === 'cannot_answer'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : verdict === 'error'
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-block text-xs px-2 py-1 rounded border font-medium ${colour}`}>
      {verdict}
    </span>
  );
}

function ChunkRow({ chunk, rank }: { chunk: TopChunk; rank: number }) {
  const score = typeof chunk.score === 'number' ? chunk.score.toFixed(3) : '—';
  return (
    <li className="bg-gray-50 border border-gray-200 rounded p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-gray-500">
          #{rank} · cosine <span className="font-mono">{score}</span>
        </div>
        <a
          href={chunk.doc_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-700 hover:underline"
        >
          {chunk.doc_title || chunk.doc_url}
        </a>
      </div>
      {chunk.section_heading && (
        <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
          {chunk.section_heading}
        </div>
      )}
      <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-6">
        {chunk.content_snippet}
      </p>
    </li>
  );
}
