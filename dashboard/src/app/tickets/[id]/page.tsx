'use client';

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import DecisionChain from '@/components/DecisionChain';
import type { Ticket, TicketRun } from '@/lib/types';

type Props = { params: Promise<{ id: string }> };

interface DetailResponse {
  ticket: Ticket;
  runs: TicketRun[];
  history: { id: string; old_status: string | null; new_status: string; changed_by: string; notes: string | null; created_at: string }[];
}

export default function TicketDetailPage({ params }: Props) {
  const { id } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [editingResponse, setEditingResponse] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/tickets/${id}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: 'approve' | 'reject' | 'edit_and_send') => {
    setActing(action);
    try {
      const res = await fetch(`/api/tickets/${id}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          edited_response: action === 'edit_and_send' ? editingResponse : undefined,
        }),
      });
      const j = await res.json();
      if (j.error) setError(j.error);
      else load();
    } finally {
      setActing(null);
    }
  };

  if (error)
    return (
      <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded text-sm">
        {error}
      </div>
    );
  if (!data)
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        Loading…
      </div>
    );

  const { ticket, runs, history } = data;
  const latestRun = runs[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-sky-700 hover:underline">
          ← back to queue
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{ticket.subject}</h1>
        <div className="text-sm text-gray-500 mt-1">
          {ticket.customer_email} ·{' '}
          {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })} · status{' '}
          <span className="font-mono">{ticket.status}</span>
        </div>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Ticket body</h3>
        <pre className="bg-white border border-gray-200 rounded p-3 text-sm whitespace-pre-wrap font-sans">
          {ticket.body}
        </pre>
      </section>

      {latestRun && (
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Decision chain (latest run)</h2>
          <DecisionChain run={latestRun} />
        </section>
      )}

      {ticket.status === 'human_review' && latestRun?.draft_response && (
        <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Human action</h2>
          {editingResponse !== null ? (
            <>
              <textarea
                className="w-full h-40 border border-gray-300 rounded p-3 text-sm font-mono"
                value={editingResponse}
                onChange={(e) => setEditingResponse(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => act('edit_and_send')}
                  disabled={!!acting}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm rounded"
                >
                  Send edited
                </button>
                <button
                  onClick={() => setEditingResponse(null)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => act('approve')}
                disabled={!!acting}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm rounded"
              >
                {acting === 'approve' ? 'Approving…' : 'Approve & send draft'}
              </button>
              <button
                onClick={() => setEditingResponse(latestRun.draft_response ?? '')}
                disabled={!!acting}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded"
              >
                Edit & send
              </button>
              <button
                onClick={() => act('reject')}
                disabled={!!acting}
                className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-sm rounded"
              >
                {acting === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          )}
        </section>
      )}

      {runs.length > 1 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Earlier runs ({runs.length - 1})</h3>
          <ul className="space-y-2 text-xs">
            {runs.slice(1).map((r) => (
              <li key={r.id} className="bg-white border border-gray-200 rounded p-2 font-mono">
                {r.created_at} · verdict={r.verdict} reason={r.verdict_reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Status history</h3>
        <ol className="space-y-1 text-xs font-mono">
          {history.map((h) => (
            <li key={h.id} className="text-gray-600">
              {h.created_at} · {h.old_status ?? '∅'} → {h.new_status} · by {h.changed_by}
              {h.notes ? ` · ${h.notes}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
