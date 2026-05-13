'use client';

import { useEffect, useState } from 'react';
import TicketTable from '@/components/TicketTable';
import type { TicketWithLatestRun } from '@/lib/types';

export default function QueuePage() {
  const [tickets, setTickets] = useState<TicketWithLatestRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tickets?status=human_review,error,processing')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setTickets(data.tickets);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tickets the confidence gate routed to humans, plus any in-flight or errored runs.
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
        <TicketTable
          tickets={tickets}
          emptyMessage="No tickets need review. All inbound tickets either auto-sent or are still processing."
        />
      )}
    </div>
  );
}
