// Collapse consecutive identical strings in an array.
//
// Why this exists: Intercom help-center articles render some paragraphs
// twice in adjacent DOM nodes (a visible <p> + an a11y/duplicate <li>
// inside step lists). The scraper picks both up via querySelectorAll,
// producing duplicated lines. Removing only *consecutive* duplicates is
// safe — a paragraph that happens to repeat later in the article (e.g. a
// reused warning) is preserved.

export function dedupConsecutive(arr) {
  return arr.filter((item, i, a) => item !== a[i - 1]);
}
