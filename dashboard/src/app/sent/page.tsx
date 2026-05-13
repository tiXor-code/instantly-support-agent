'use client';

import { useEffect, useState } from 'react';
import TicketTable from '@/components/TicketTable';
import type { TicketWithLatestRun } from '@/lib/types';

export default function SentPage() {
  const [tickets, setTickets] = useState<TicketWithLatestRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tickets?status=auto_sent,sent')
      .then((r) => r.json())
      .then((d) => !cancelled && (d.error ? setError(d.error) : setTickets(d.tickets)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sent</h1>
          <p className="text-sm text-gray-500 mt-1">
            Auto-sent + human-approved responses. Spot-check this for false positives.
          </p>
        </div>
        {tickets && (
          <div className="text-xs text-gray-500">
            {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}
      {tickets === null && !error && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}
      {tickets && (
        <TicketTable tickets={tickets} emptyMessage="Nothing sent yet." />
      )}
    </div>
  );
}
