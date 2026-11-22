import type { Result } from './gallery';

export type RecallPage = {
  items: { photo: Result; captured: number | null; evidence: string[]; place: string | null; matchKind?: 'visual' }[];
  next: number | null;
  photoLocationsNeeded?: boolean;
};

export type LegacyRecallSearch = (
  query: string, category: string | null, start: number | null, end: number | null,
  place: string | null, collection: string | null, textOnly: boolean, offset: number,
) => Promise<RecallPage>;
export type RecallSearch = (request: RecallRequest, offset: number) => Promise<RecallPage>;
export type RecallSource = 'gallery' | 'picker';
export type VisualSearchOptions = {
  start: number | null; end: number | null; month: number | null; place: string | null; source: RecallSource | null;
};
export type RecallSearchOptions = {
  terms: string; category: string | null; start: number | null; end: number | null; month: number | null;
  place: string | null; placeHint?: { name: string; terms: string }; textOnly: boolean; source?: RecallSource | null;
};

export type RecallStatus = { pending: number; locationsEnabled?: boolean; locationsPending?: number; running: boolean };
export type RecallDate = { start: number; end: number; label: string; month?: never } |
  { start: null; end: null; label: string; month: number };
export type RecallRequest = { terms: string; category: string | null; date: RecallDate | null; place: string | null;
  placeHint?: RecallSearchOptions['placeHint']; textOnly: boolean; source?: RecallSource | null };

export const emptyRecallRequest: RecallRequest = {
  terms: '', category: null, date: null, place: null, textOnly: false,
};

export const recallCategories = [
  'Receipts', 'Documents', 'Screenshots', 'Notes and whiteboards', 'Shopping references', 'Other references',
] as const;

export const recallDateLabels = ['Today', 'Yesterday', 'This month', 'Last month', 'This year'] as const;

const categoryWords: [RegExp, (typeof recallCategories)[number]][] = [
  [/\b(?:shopping references?|shopping lists?)\b/i, 'Shopping references'],
  [/\b(?:notes? and whiteboards?|whiteboards?)\b/i, 'Notes and whiteboards'],
  [/\b(?:screen ?shots?|screen captures?)\b/i, 'Screenshots'],
  [/\breceipts?\b/i, 'Receipts'],
  [/\bdocuments?\b/i, 'Documents'],
];

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const months = monthNames.map((name) => name === 'September' ? 'Sep(?:t(?:ember)?)?' :
  name.length > 3 ? `${name.slice(0, 3)}(?:${name.slice(3)})?` : name).join('|');
const datedMonth = new RegExp(`\\b(?:(?:in|during|from)\\s+)?(${months})\\.?\\s+((?:19|20)\\d{2})\\b`, 'i');
const bareMonth = new RegExp(`\\b(?:(?:in|during|from)\\s+(${months})\\b\\.?|(${months})\\b\\.?(?=[\\s,?!]*$))`, 'i');
const isoDate = /\b(?:(?:on|from)\s+)?((?:19|20)\d{2})-(\d{2})-(\d{2})\b/i;
const datedYear = /\b(?:in|during|from)\s+((?:19|20)\d{2})\b/i;
const relativeDate = /\b(?:(?:from|in|on|during)\s+)?(today|yesterday|(?:this|last) (?:week|month|year))\b/i;

export function recallDateRange(label: string, now = new Date()): RecallDate | null {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  // Work in calendar days so 23/25-hour days still end at local midnight.
  const date = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
  const range = (start: number, end: number): RecallDate => ({ start, end, label });
  switch (label.toLowerCase()) {
    case 'today': return range(date(year, month, day), date(year, month, day + 1));
    case 'yesterday': return range(date(year, month, day - 1), date(year, month, day));
    case 'this week':
    case 'last week': {
      const monday = day - ((now.getDay() + 6) % 7) - (label.toLowerCase() === 'last week' ? 7 : 0);
      return range(date(year, month, monday), date(year, month, monday + 7));
    }
    case 'this month': return range(date(year, month, 1), date(year, month + 1, 1));
    case 'last month': return range(date(year, month - 1, 1), date(year, month, 1));
    case 'this year': return range(date(year, 0, 1), date(year + 1, 0, 1));
    case 'last year': return range(date(year - 1, 0, 1), date(year, 0, 1));
    default: return null;
  }
}

function findDate(query: string, now: Date): { range: RecallDate; matched: string } | null {
  const relative = query.match(relativeDate);
  if (relative) {
    const lower = relative[1].toLowerCase();
    const range = recallDateRange(lower[0].toUpperCase() + lower.slice(1), now);
    if (range) return { range, matched: relative[0] };
  }
  const exact = query.match(isoDate);
  if (exact) {
    const [, y, m, d] = exact;
    const start = new Date(Number(y), Number(m) - 1, Number(d));
    if (start.getMonth() !== Number(m) - 1 || start.getDate() !== Number(d)) return null;
    return { range: { start: start.getTime(), end: new Date(Number(y), Number(m) - 1, Number(d) + 1).getTime(), label: `${y}-${m}-${d}` }, matched: exact[0] };
  }
  const named = query.match(datedMonth);
  if (named) {
    const month = monthNames.findIndex((name) => name.toLowerCase().startsWith(named[1].toLowerCase()));
    const year = Number(named[2]);
    return {
      range: { start: new Date(year, month, 1).getTime(), end: new Date(year, month + 1, 1).getTime(), label: `${monthNames[month]} ${year}` },
      matched: named[0],
    };
  }
  const annual = query.match(datedYear);
  if (annual) {
    const year = Number(annual[1]);
    return { range: { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime(), label: String(year) }, matched: annual[0] };
  }
  const standalone = query.match(bareMonth);
  if (standalone) {
    const month = monthNames.findIndex((name) => name.toLowerCase().startsWith((standalone[1] ?? standalone[2]).toLowerCase()));
    return { range: { start: null, end: null, label: monthNames[month], month: month + 1 }, matched: standalone[0] };
  }
  return null;
}

function namedPlace(query: string, places: readonly string[]) {
  for (const place of [...places].sort((left, right) => right.length - left.length)) {
    const escaped = place.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b(?:in|at|near|from)\\s+${escaped}(?=$|[\\s,.!?])`, 'iu').exec(query);
    if (match) return { match: match[0], place };
  }
  return null;
}

export function visionSceneTerms(reply: string): string[] {
  try {
    const content = reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    const terms = JSON.parse(content)?.terms;
    if (!Array.isArray(terms)) return [];
    return [...new Set(terms.slice(0, 3).flatMap((value: unknown) => {
      if (typeof value !== 'string' || value.length > 48) return [];
      const term = value.trim().toLowerCase();
      return /^[a-z]+(?:[ -][a-z]+){0,2}$/.test(term) ? [term] : [];
    }))];
  } catch { return []; }
}

export function parseRecallQuery(query: string, now = new Date(), savedPlaces: readonly string[] = []): RecallRequest {
  let terms = query.trim().slice(0, 256);
  const location = terms.match(/\bplace:\s*(?:"([^"]{1,80})"|([^\s,"]{1,80}))/i);
  if (location) terms = terms.replace(location[0], ' ');
  const date = findDate(terms, now);
  if (date) terms = terms.replace(date.matched, ' ');
  const remembered = location ? null : namedPlace(terms, savedPlaces);
  if (remembered) terms = terms.replace(remembered.match, ' ');

  let category: string | null = null;
  for (const [pattern, name] of categoryWords) {
    if (!pattern.test(terms)) continue;
    category = name;
    terms = terms.replace(pattern, ' ');
    break;
  }
  const textOnly = /\b(?:with text|containing text)\b/i.test(terms);
  terms = terms.replace(/\b(?:with text|containing text)\b/i, ' ')
    .replace(/\b(?:in the background|as (?:the|a) backdrop|in (?:the|a) scene)\b/gi, ' ');
  const clean = (value: string) => value.replace(/^\s*(?:please\s+)?(?:show me|find|look for|where are|do i have)\b/i, '')
    .replace(/\b(?:my|me|please|photos?|pictures?|images?|from|in|on|at|near|with|of|the|a|an|during)\b/gi, ' ')
    .replace(/[\s,?!]+$/g, '').replace(/\s+/g, ' ').trim();
  const explicitPlace = (location?.[1] ?? location?.[2] ?? remembered?.place)?.trim();
  const text = clean(terms);
  const savedPlace = savedPlaces.find((name) => name.toLocaleLowerCase() === text.toLocaleLowerCase());
  const place = explicitPlace || savedPlace || null;
  const trailingPlace = !place ? /\b(?:in|at|near|from)\s+([^,?!]{1,80}?)[\s,?!]*$/i.exec(terms) : null;
  const placeHint = trailingPlace && trailingPlace.index != null && {
    name: trailingPlace[1].trim(), terms: clean(terms.slice(0, trailingPlace.index)),
  };
  return { terms: !explicitPlace && savedPlace ? '' : text, category, date: date?.range ?? null, place,
    ...(placeHint ? { placeHint } : {}), textOnly };
}

export function hasRecallRequest(request: RecallRequest): boolean {
  return Boolean(request.terms || request.category || request.date || request.place || request.textOnly || request.source);
}
