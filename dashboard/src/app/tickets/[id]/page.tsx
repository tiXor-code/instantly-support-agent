type Props = { params: Promise<{ id: string }> };

export default async function TicketDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ticket detail</h1>
        <p className="text-sm text-gray-500 mt-1 font-mono">{id}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        Decision chain view ships in Phase 5.
      </div>
    </div>
  );
}
