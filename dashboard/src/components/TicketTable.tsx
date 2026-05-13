'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { TicketWithLatestRun } from '@/lib/types';
import CategoryBadge from './CategoryBadge';
import ConfidenceBadge from './ConfidenceBadge';

type Props = {
  tickets: TicketWithLatestRun[];
  emptyMessage?: string;
};

export default function TicketTable({ tickets, emptyMessage = 'No tickets.' }: Props) {
  if (tickets.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Subject</th>
            <th className="text-left px-4 py-2 font-medium">Category</th>
            <th className="text-left px-4 py-2 font-medium">Confidence</th>
            <th className="text-left px-4 py-2 font-medium">Verdict reason</th>
            <th className="text-left px-4 py-2 font-medium">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tickets.map((t) => {
            const run = t.latest_run;
            const cat = run?.classification?.category ?? null;
            const top1 = run?.top_chunks?.[0]?.score ?? null;
            const sgMin = run?.self_grade
              ? Math.min(
                  run.self_grade.grounded_in_cited_doc,
                  run.self_grade.directly_answers_question
                )
              : null;
            return (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/tickets/${t.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {t.subject}
                  </Link>
                  <div className="text-xs text-gray-500 mt-0.5">{t.customer_email}</div>
                </td>
                <td className="px-4 py-3">
                  <CategoryBadge category={cat} />
                </td>
                <td className="px-4 py-3">
                  <ConfidenceBadge cosine={top1} selfGradeMin={sgMin} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                  {run?.verdict_reason ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
