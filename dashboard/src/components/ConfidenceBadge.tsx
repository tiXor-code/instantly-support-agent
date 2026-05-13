type Props = {
  cosine: number | null;
  selfGradeMin: number | null;
};

// Visual summary of the two gating signals — top1 cosine (L1) and the min
// of grounded/directly_answers from self-grade (L2). Used in queue + sent
// rows to give reviewers a one-glance read on why a ticket landed where
// it did.
export default function ConfidenceBadge({ cosine, selfGradeMin }: Props) {
  const cosineColor =
    cosine == null
      ? 'bg-gray-100 text-gray-500'
      : cosine >= 0.78
      ? 'bg-emerald-100 text-emerald-700'
      : cosine >= 0.6
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';

  const sgColor =
    selfGradeMin == null
      ? 'bg-gray-100 text-gray-500'
      : selfGradeMin >= 4
      ? 'bg-emerald-100 text-emerald-700'
      : selfGradeMin >= 3
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';

  return (
    <div className="flex gap-1.5 items-center text-[11px] font-mono">
      <span className={`px-1.5 py-0.5 rounded ${cosineColor}`} title="top-1 cosine similarity (L1)">
        cos {cosine != null ? cosine.toFixed(2) : '—'}
      </span>
      <span className={`px-1.5 py-0.5 rounded ${sgColor}`} title="min(grounded, directly_answers) (L2)">
        sg {selfGradeMin != null ? selfGradeMin : '—'}/5
      </span>
    </div>
  );
}
