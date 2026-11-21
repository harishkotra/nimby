import type { RecallPage } from './recallQuery';

type Hit = RecallPage['items'][number];

function tier(hit: Hit, query: string): number {
  const text = hit.evidence.find((item) => item.startsWith('Photo text: '));
  if (text?.toLocaleLowerCase().includes(query)) return 0;
  if (hit.evidence.some((item) => item.startsWith('Eye tag: ') && item.toLocaleLowerCase().includes(query))) return 1;
  return 2;
}

/** Use reported outcomes to break ties without moving a weaker match ahead of exact evidence. */
export function applyRecallFeedback(page: RecallPage, query: string, scores: ReadonlyMap<string, number>): RecallPage {
  const normalized = query.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
  if (!normalized || !scores.size) return page;
  const items: Hit[] = [];
  for (let start = 0; start < page.items.length;) {
    const match = tier(page.items[start], normalized);
    let end = start + 1;
    while (end < page.items.length && tier(page.items[end], normalized) === match) end++;
    items.push(...page.items.slice(start, end).sort((first, second) =>
      (scores.get(second.photo.id) ?? 0) - (scores.get(first.photo.id) ?? 0)));
    start = end;
  }
  return { ...page, items };
}
