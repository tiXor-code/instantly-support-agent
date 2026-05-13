import { CATEGORY_COLOURS, CATEGORY_LABELS, type Category } from '@/lib/types';

export default function CategoryBadge({ category }: { category?: string | null }) {
  if (!category) return null;
  const cat = category as Category;
  const colour = CATEGORY_COLOURS[cat] ?? CATEGORY_COLOURS.other;
  const label = CATEGORY_LABELS[cat] ?? category;
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded border ${colour} font-medium`}>
      {label}
    </span>
  );
}
