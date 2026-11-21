import type { Result } from './gallery';

export type NextStepKind = 'shopping' | 'receipt';
export type NextStepPhoto = {
  photo: Result;
  kind: NextStepKind;
  text: string;
  captured: number | null;
  state: 'scheduled' | 'delivered' | null;
  due: number;
};

const money = /(?:[$€£₹]\s*\d[\d,.]*|\b(?:USD|EUR|GBP|INR|CAD|AUD)\s+\d[\d,.]*)/gi;
const boilerplate = /\b(cart|buy now|shipping|delivery|reviews?|ratings?|store|search|menu|sponsored|filter|returns?|regular price|was|save \d|account|wishlist|checkout|sub ?total|tax|receipt|order date)\b/i;
const stopwords = new Set(['with', 'from', 'your', 'this', 'item', 'black', 'white', 'size', 'product', 'price', 'sale', 'shipping', 'online']);
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const linesOf = (text: string) => text.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);

const interfaceText = /\b(cart|checkout|wishlist|shipping|delivery|reviews?|ratings?|stars|search|menu|sponsored|filter|account|sign in|log in|shop by|your orders|buy now|free returns|product details|customer service|terms of use|privacy policy|coupon|subtotal|sold by)\b/i;
const storefrontSuffix = /\s+(?:[·|•]\s*)?(?:add to (?:cart|bag|basket)|buy now|(?:free|standard) (?:shipping|delivery)|\d+(?:\.\d+)?\s+(?:stars|reviews?))\b.*$/i;
const productWords = (text: string) => text.match(/[\p{L}\d-]+/gu) ?? [];

function hasProductCode(text: string) {
  return productWords(text).some((word) => /\p{L}/u.test(word) && /\d/.test(word) &&
    !/^\d+(gb|tb|oz|kg|mm|cm|pack)$/i.test(word));
}

export function productQueryCandidates(ocr: string): string[] {
  const seen = new Set<string>();
  return linesOf(ocr).map((raw, position) => {
    const text = raw.replace(money, ' ').trim().replace(storefrontSuffix, '').replace(/[·|•\s]+$/g, '').replace(/\s+/g, ' ');
    return { text, position, words: productWords(text), hasCode: hasProductCode(text) };
  })
    .filter(({ text, words, hasCode }) => {
      if (text.length < (hasCode ? 3 : 6) || text.length > 120 || (words.length < 2 && !hasCode) || !/\p{L}/u.test(text) ||
          /https?:|[@<>]|[$€£₹]|\b\d{7,}\b|\b\d{4}-\d{2}-\d{2}\b/i.test(text) || interfaceText.test(text)) return false;
      const folded = text.toLowerCase();
      if (seen.has(folded)) return false;
      seen.add(folded);
      return true;
    }).map(({ text, position, words, hasCode }) => ({
      text, weight: (hasCode ? 16 : 0) + Math.min(words.length, 7) - Math.min(position, 14) * 0.5,
    })).sort((a, b) => b.weight - a.weight).slice(0, 3).map(({ text }) => text);
}

export function productQuery(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length >= 3 && text.length <= 120 && /\p{L}/u.test(text) ? text : '';
}

export function visionProductQuery(reply: string): string {
  try {
    const raw = reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    const name = JSON.parse(raw)?.name;
    if (typeof name !== 'string' || /https?:|[@<>\x00-\x1f$€£₹]/i.test(name) || interfaceText.test(name)) return '';
    return productQuery(name);
  } catch { return ''; }
}

export type ReceiptSuggestion = 'return_reminder' | 'review_receipt';

export function receiptSuggestion(reply: string, hasFutureDeadline: boolean): ReceiptSuggestion | null {
  try {
    const raw = reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    const action = JSON.parse(raw)?.action;
    if (action === 'review_receipt') return action;
    if (action === 'return_reminder' && hasFutureDeadline) return action;
  } catch { /* The model declined or returned an unsupported format. */ }
  return null;
}

export function googleShoppingUrl(query: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

export function shoppingFacts(text: string) {
  const lines = linesOf(text);
  const label = productQueryCandidates(text)[0];
  const prices = new Set(lines.filter((line) => !boilerplate.test(line)).flatMap((line) => line.match(money) ?? [])
    .map((price) => price.replace(/\s+/g, ' ').replace(/[.,]+$/, '')));
  const price = prices.size === 1 ? [...prices][0] : null;
  const url = lines.flatMap((line) => line.match(/https:\/\/[^\s<>"']+/gi) ?? []).flatMap((raw) => {
    try {
      const parsed = new URL(raw.replace(/[).,;]+$/, ''));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname === '/') return [];
      if (!/^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(parsed.hostname) || /\.(localhost|local|internal)$/i.test(parsed.hostname)) return [];
      return [{ url: parsed.href, host: parsed.hostname }];
    } catch { return []; }
  })[0];
  return { label: label ?? null, price, url };
}

export function relatedShopping(item: NextStepPhoto, all: NextStepPhoto[]) {
  const tokens = (photo: NextStepPhoto) => new Set((shoppingFacts(photo.text).label?.toLowerCase().match(/[\p{L}\d-]{3,}/gu) ?? [])
    .filter((word) => !stopwords.has(word) && /\p{L}/u.test(word)));
  const wanted = tokens(item);
  if (wanted.size < 2) return [];
  return all.filter((other) => other.kind === 'shopping' && other.photo.id !== item.photo.id &&
    [...tokens(other)].filter((word) => wanted.has(word)).length >= 2).slice(0, 3);
}

export function localDate(value: string, hour = 9, minute = 0): Date | null {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute ? date : null;
}

export function reminderDate(date: string, time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  return match ? localDate(date, Number(match[1]), Number(match[2])) : null;
}

export function dateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function receiptFacts(text: string) {
  const lines = linesOf(text);
  const amounts = new Set(lines.filter((line) => /^(?:(?:grand|amount)\s+)?total(?:\s+paid)?\s*[: ]/i.test(line))
    .flatMap((line) => line.match(money) ?? []).map((amount) => amount.replace(/[.,]+$/, '')));
  const boundaries = new Set(lines.flatMap((line) => {
    const deadline = line.match(/\b(?:return by|last day to return|return deadline)\s*:?\s*(.+)/i)?.[1];
    if (!deadline) return [];
    const iso = deadline.match(/^20\d{2}-\d{2}-\d{2}\b/)?.[0];
    const named = deadline.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
    const month = named ? months.findIndex((label) => [label, label.slice(0, 3)].some((name) => name.toLowerCase() === named[1].toLowerCase())) + 1 : 0;
    const date = iso ?? (month && named ? `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}` : '');
    return localDate(date) ? [date] : [];
  }));
  return { total: amounts.size === 1 ? [...amounts][0] : null, returnBy: boundaries.size === 1 ? [...boundaries][0] : null };
}
