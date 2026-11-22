export const retailerConfigUrl = 'https://production.d3ulvfvvudr0cr.amplifyapp.com/product-search.json';

export function retailerOverride(value: string | undefined, development: boolean): string | null {
  try {
    const url = new URL(value?.trim() ?? '');
    if (url.username || url.password || url.hash) return null;
    const local = url.hostname === '127.0.0.1' || url.hostname === '10.0.2.2';
    return url.protocol === 'https:' || (development && local && url.protocol === 'http:') ? url.href : null;
  } catch { return null; }
}

export async function fetchRetailerEndpoint(signal: AbortSignal, request = fetch): Promise<string | null> {
  try {
    const response = await request(retailerConfigUrl, { signal });
    if (!response.ok) return null;
    const config = await response.json();
    if (config?.version !== 1 || typeof config.endpoint !== 'string') return null;
    const url = new URL(config.endpoint);
    return url.protocol === 'https:' && /^[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/product-search' ? url.href : null;
  } catch { return null; }
}
