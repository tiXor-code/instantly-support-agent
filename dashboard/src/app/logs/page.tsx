'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import CategoryBadge from '@/components/CategoryBadge';

interface RunRow {
  id: string;
  ticket_id: string;
  classification: { category?: string };
  top_chunks: { score?: number }[];
  draft_response: string | null;
  self_grade: { grounded_in_cited_doc: number; directly_answers_question: number; tone_appropriate: number } | null;
  verdict: string;
  verdict_reason: string;
  auto_sent: boolean;
  latency_ms: number | null;
  created_at: string;
  tickets: { subject: string };
}

export default function LogsPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runs?limit=300')
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setRuns(d.runs)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every ticket run, newest first. Use this for the README threshold-tuning analysis.
          </p>
        </div>
        {runs && (
          <button
            onClick={() => exportCsv(runs)}
            className="text-xs text-sky-700 hover:underline"
          >
            export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}
      {runs === null && !error && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}
      {runs && runs.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
          No runs yet.
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Ticket</th>
                <th className="text-left px-3 py-2 font-medium">Cat</th>
                <th className="text-left px-3 py-2 font-medium">cos</th>
                <th className="text-left px-3 py-2 font-medium">grnd</th>
                <th className="text-left px-3 py-2 font-medium">ans</th>
                <th className="text-left px-3 py-2 font-medium">tone</th>
                <th className="text-left px-3 py-2 font-medium">verdict</th>
                <th className="text-left px-3 py-2 font-medium">reason</th>
                <th className="text-left px-3 py-2 font-medium">latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/tickets/${r.ticket_id}`} className="text-sky-700 hover:underline">
                      {r.tickets?.subject ?? r.ticket_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <CategoryBadge category={r.classification?.category ?? null} />
                  </td>
                  <td className="px-3 py-2 font-mono">{r.top_chunks?.[0]?.score?.toFixed?.(2) ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.self_grade?.grounded_in_cited_doc ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.self_grade?.directly_answers_question ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.self_grade?.tone_appropriate ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">
                    <span
                      className={
                        r.verdict === 'auto_send'
                          ? 'text-emerald-700'
                          : r.verdict === 'cannot_answer'
                          ? 'text-amber-700'
                          : r.verdict === 'error'
                          ? 'text-rose-700'
                          : 'text-gray-700'
                      }
                    >
                      {r.verdict}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{r.verdict_reason}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{r.latency_ms ?? '—'}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function exportCsv(runs: RunRow[]) {
  const rows = [
    ['created_at', 'ticket_id', 'subject', 'category', 'top1_cosine', 'grounded', 'directly_answers', 'tone', 'verdict', 'verdict_reason', 'latency_ms'],
    ...runs.map((r) => [
      r.created_at,
      r.ticket_id,
      JSON.stringify(r.tickets?.subject ?? ''),
      r.classification?.category ?? '',
      r.top_chunks?.[0]?.score?.toFixed?.(4) ?? '',
      r.self_grade?.grounded_in_cited_doc ?? '',
      r.self_grade?.directly_answers_question ?? '',
      r.self_grade?.tone_appropriate ?? '',
      r.verdict,
      r.verdict_reason,
      r.latency_ms ?? '',
    ]),
  ];
  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `instantly-support-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
