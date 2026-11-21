import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://api.tavily.com/search';
const excludedDomains = ['reddit.com', 'youtube.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'pinterest.com', 'wikipedia.org'];
const generic = new Set(['with', 'for', 'and', 'the', 'buy', 'online', 'new', 'original', 'product']);
const accessoryWords = /\b(?:case|cover|skin|protector|replacement|adapter|cable|stand|strap|mount|compatible|skins|accessories)\b/i;
const storefrontPath = /\/(?:product(?:s|-details)?|dp|gp\/product|p|ip|itm|shop|store|listing)(?:\/|$)/i;
const purchaseCue = /\b(?:add to (?:cart|bag|basket)|buy now|buy online|purchase online|in stock|out of stock|sold out|ships from)\b/i;

function words(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\p{L}+)[-‐‑](?=\d)/gu, '$1')
    .replace(/\b([a-z]{1,4})\s+(?=\d{2,}[a-z])/g, '$1').match(/[\p{L}\d]+/gu) ?? [];
}

export function matchingListings(query, entries) {
  const required = [...new Set(words(query).filter((word) => !generic.has(word)))];
  const seen = new Set();
  const listed = [];
  if (!required.length || !Array.isArray(entries)) return listed;
  for (const entry of entries.slice(0, 12)) {
    if (typeof entry?.title !== 'string' || typeof entry.url !== 'string') continue;
    const title = entry.title.trim().replace(/\s+/g, ' ');
    const titleWords = new Set(words(title));
    if (!required.every((word) => titleWords.has(word))) continue;
    if (!accessoryWords.test(query) && accessoryWords.test(title)) continue;
    if (/\b(?:review|unboxing|versus|comparison|buyer'?s guide)\b/i.test(title)) continue;
    let url;
    try { url = new URL(entry.url); } catch { continue; }
    const { hostname } = url;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname === '/' ||
        !/^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(hostname) || /\.(localhost|local|internal)$/i.test(hostname) ||
        excludedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) continue;
    if (/\/(?:blogs?|news|reviews?|compare|collections?|search|help)(?:\/|$)/i.test(url.pathname)) continue;
    if (!storefrontPath.test(url.pathname) && !purchaseCue.test(`${title} ${String(entry.content ?? '').slice(0, 2500)}`)) continue;
    url.hash = '';
    for (const param of [...url.searchParams.keys()]) {
      if (/^utm_|^(tag|ref|ref_|source|gclid|fbclid)$/i.test(param)) url.searchParams.delete(param);
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    listed.push({ title: title.slice(0, 200), url: url.href, store: hostname.replace(/^www\./, '') });
    if (listed.length === 6) break;
  }
  return listed;
}

export async function searchListings(query, key, fetcher = fetch) {
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `${query} buy online retailer`, search_depth: 'basic', topic: 'general', max_results: 12,
      auto_parameters: false, include_answer: false, include_raw_content: false, exclude_domains: excludedDomains }),
  });
  if (!response.ok) {
    throw new Error([429, 432, 433].includes(response.status) ? 'Search quota is unavailable. Try Google Shopping.' : 'Tavily search is unavailable.');
  }
  const data = await response.json();
  return matchingListings(query, data.results);
}

export function parseProductRequest(text) {
  if (Buffer.byteLength(text) > 1024) return null;
  try {
    const body = JSON.parse(text);
    const query = typeof body?.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
    return Object.keys(body ?? {}).length === 1 && query.length >= 3 && query.length <= 120 && /\p{L}/u.test(query) ? query : null;
  } catch { return null; }
}

async function readQuery(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) return null;
    chunks.push(chunk);
  }
  return parseProductRequest(Buffer.concat(chunks).toString('utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    process.stderr.write('Add TAVILY_API_KEY to .env to start product search.\n');
    process.exitCode = 1;
  } else {
    const recent = [];
    const server = createServer({ requestTimeout: 15_000, headersTimeout: 5_000 }, async (request, response) => {
      const reply = (status, body) => {
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(body));
      };
      if (request.method !== 'POST' || request.url !== '/product-search') return reply(404, { error: 'Not found.' });
      if (request.headers.origin || !request.headers['content-type']?.startsWith('application/json')) {
        return reply(415, { error: 'Expected a Nimby JSON request.' });
      }
      const query = await readQuery(request).catch(() => null);
      if (!query) return reply(400, { error: 'Enter a product name or model.' });
      const now = Date.now();
      while (recent.length && recent[0] <= now - 60_000) recent.shift();
      if (recent.length >= 12) return reply(429, { error: 'Too many searches. Try again in a minute.' });
      recent.push(now);
      try { reply(200, { listings: await searchListings(query, key) }); }
      catch (error) {
        const message = error instanceof Error && error.message.startsWith('Search quota') ? error.message : 'Could not reach Tavily. Try Google Shopping.';
        reply(502, { error: message });
      }
    });
    server.listen(8787, '127.0.0.1', () => process.stdout.write('Nimby product search is listening on 127.0.0.1:8787.\n'));
  }
}
