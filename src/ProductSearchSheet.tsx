import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionSheet } from './ActionSheet';
import { native } from './gallery';
import { ReadingStatus } from './ReadingStatus';
import { googleShoppingUrl, productQuery, productQueryCandidates, visionProductQuery } from './nextStepFacts';
import { fetchRetailerEndpoint, retailerOverride } from './retailerEndpoint';
import { ActionLink, Body, Button, color, ErrorText, Heading, Icon, Segments, styles } from './ui';

type Listing = { title: string; url: string; store: string };
const readers = [{ value: 'ocr', label: 'OCR' }, { value: 'qwen', label: 'Qwen vision' }] as const;
type Reader = typeof readers[number]['value'];
type ReadState = 'reading' | 'no-title' | 'unavailable' | 'done';

function retailerListings(value: unknown): Listing[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((item) => {
    if (typeof item?.title !== 'string' || typeof item.url !== 'string') return [];
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !/^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(localhost|local|internal)$/i.test(url.hostname)) return [];
      return [{ title: item.title.slice(0, 200), url: url.href, store: url.hostname.replace(/^www\./, '') }];
    } catch { return []; }
  });
}

export function ProductSearchSheet({ imageId, screenshotText, close }: {
  imageId: string; screenshotText: string; close: () => void;
}) {
  const cachedTitle = useMemo(() => productQueryCandidates(screenshotText)[0], [screenshotText]);
  const [text, setText] = useState(cachedTitle ?? '');
  const [results, setResults] = useState<{ query: string; listings: Listing[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [readState, setReadState] = useState<ReadState>(
    cachedTitle ? 'done' : native?.readShoppingText ? 'reading' : 'unavailable',
  );
  const [reader, setReader] = useState<Reader>('ocr');
  const selectedReader = useRef<Reader>('ocr');
  const [vision, setVision] = useState(() => native?.productVisionStatus?.());
  const [visionPending, setVisionPending] = useState(false);
  const [visionError, setVisionError] = useState('');
  const mounted = useRef(false);
  const [error, setError] = useState('');
  const edited = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [endpoint, setEndpoint] = useState<string | null | undefined>(() =>
    retailerOverride(process.env.EXPO_PUBLIC_PRODUCT_SEARCH_URL, __DEV__) ?? undefined);
  const query = productQuery(text);

  useEffect(() => {
    if (endpoint !== undefined) return;
    const config = new AbortController();
    let active = true;
    const timeout = setTimeout(() => { config.abort(); if (active) setEndpoint(null); }, 3_500);
    void fetchRetailerEndpoint(config.signal).then((url) => {
      if (active && !config.signal.aborted) setEndpoint(url);
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; config.abort(); clearTimeout(timeout); };
  }, [endpoint]);

  useEffect(() => {
    const read = native?.readShoppingText;
    if (reader !== 'ocr') return;
    if (cachedTitle) {
      if (!edited.current) { setText(cachedTitle); setResults(null); setError(''); }
      setReadState('done');
      return;
    }
    if (!read) { setReadState('unavailable'); return; }
    let active = true;
    setReadState('reading');
    void read(imageId).then((result) => {
      if (!active || selectedReader.current !== 'ocr') return;
      const title = result == null ? undefined : productQueryCandidates(result)[0];
      if (title && !edited.current) { setText(title); setResults(null); setError(''); }
      setReadState(title ? 'done' : result == null ? 'unavailable' : 'no-title');
    }).catch(() => { if (active) setReadState('unavailable'); });
    return () => { active = false; };
  }, [imageId, cachedTitle, reader]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const visionActive = visionPending || (vision != null && vision.phase !== 'idle');
  useEffect(() => {
    if (!visionActive) return;
    const update = () => setVision(native?.productVisionStatus?.());
    const timer = setInterval(update, 350);
    update();
    return () => clearInterval(timer);
  }, [visionActive]);

  function chooseReader(value: Reader) {
    selectedReader.current = value;
    setReader(value);
    setReadState('done');
    setVisionError('');
    // Switching to OCR restores its suggestion after Qwen has supplied the field.
    if (value === 'ocr') edited.current = false;
  }

  async function runVision(operation: 'download' | 'remove' | 'read') {
    if (!native || visionActive) return;
    setVisionPending(true);
    setVisionError('');
    setReadState(operation === 'read' ? 'reading' : 'done');
    if (operation === 'read') edited.current = false;
    try {
      if (operation === 'download') await native.installProductVision?.();
      if (operation === 'remove') await native.removeProductVision?.();
      if (operation === 'read') {
        const output = await native.identifyProductImage?.(imageId);
        if (!mounted.current || selectedReader.current !== 'qwen') return;
        const title = visionProductQuery(output ?? '');
        setReadState(title ? 'done' : 'no-title');
        if (title && !edited.current) {
          setText(title);
          setResults(null);
          setError('');
        }
      }
    } catch (cause) {
      if (!mounted.current || selectedReader.current !== 'qwen') return;
      setReadState('done');
      setVisionError(cause instanceof Error ? cause.message.slice(0, 240) : 'Qwen vision couldn’t complete the request.');
    } finally {
      if (mounted.current) {
        setVision(native.productVisionStatus?.());
        setVisionPending(false);
      }
    }
  }

  const progress = vision ? Math.min(100, Math.floor(100 * vision.received / vision.total)) : 0;

  async function open(url: string) {
    edited.current = true;
    Keyboard.dismiss();
    setError('');
    try { await Linking.openURL(url); }
    catch { setError('Could not open your browser.'); }
  }

  async function search() {
    if (!query || !endpoint || controller.current) return;
    edited.current = true;
    Keyboard.dismiss();
    setError('');
    setResults(null);
    setLoading(true);
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 20_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: request.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error.slice(0, 160) : 'Retailer search is unavailable.');
      setResults({ query, listings: retailerListings(body?.listings) });
    } catch (cause) {
      setError(request.signal.aborted ? 'Search timed out. Try again or open Google Shopping.' :
        cause instanceof Error && cause.message !== 'Network request failed' ? cause.message : 'Retailer search is unavailable. Try Google Shopping.');
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setLoading(false);
    }
  }

  function submit() {
    if (!query || loading || endpoint === undefined) return;
    if (endpoint) void search();
    else void open(googleShoppingUrl(query));
  }

  return <ActionSheet title="Find buying links" close={close}
    footer={<Button label={loading ? 'Searching…' : endpoint === undefined ? 'Checking retailer search…' :
      endpoint ? 'Find retailer links' : 'Search Google Shopping'} disabled={!query || loading || endpoint === undefined} run={submit} />}>
    <View style={styles.column}>
      {vision && <Segments options={readers} value={reader} select={chooseReader} />}
      {reader === 'qwen' && vision && <View style={layout.vision}>
        {!vision.supported ? <Body>Qwen needs a 64-bit Android device with more memory. You can still use OCR.</Body> :
          vision.phase === 'downloading' ? <>
          <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.body}>
            {`Downloading Qwen3.5 0.8B · ${progress}%`}
          </Text>
          <ActionLink label="Cancel download" run={() => native?.cancelProductVisionDownload?.()} />
        </> : vision.installed ? <>
          <Body>Qwen analyzes the image on your phone. Check the suggested name and model number.</Body>
          <View style={layout.readerActions}>
            <ActionLink label="Read with Qwen" disabled={loading || visionActive} run={() => void runVision('read')} />
            <ActionLink label="Remove download" disabled={visionActive} run={() => void runVision('remove')} />
          </View>
        </> : <>
          <Body>Qwen3.5 0.8B reads the image on your phone after a one-time download.</Body>
          <ActionLink label="Download Qwen · 1.3 GB" disabled={visionActive} run={() => void runVision('download')} />
        </>}
        {!!visionError && <ErrorText>{visionError}</ErrorText>}
      </View>}
      <Text style={layout.label}>Product name or model</Text>
      <TextInput value={text} onChangeText={(value) => { edited.current = true; setText(value); setResults(null); setError(''); }}
        accessibilityLabel="Product name or model" placeholder="Brand and model number" placeholderTextColor={color.muted}
        maxLength={120} returnKeyType="search" autoCorrect={false} onSubmitEditing={submit} editable={!loading} style={layout.input} />
      {readState === 'reading' && <ReadingStatus label={reader === 'qwen' ? 'Qwen is reading this image on your phone' : 'Reading the screenshot on your phone'} />}
      {!edited.current && (readState === 'no-title' || readState === 'unavailable') && <Text accessibilityLiveRegion="polite" style={styles.body}>
        {readState === 'no-title' ?
          'Couldn’t find a product name in this screenshot. You can enter it above.' :
          'Couldn’t read this screenshot. You can enter the product name above.'}
      </Text>}
      <Body>{endpoint === undefined ? 'Check the product name or model number before searching.' :
        endpoint ? 'Check the name before searching. Tavily receives only the search text shown here.' :
        'Check the name before opening Google Shopping in your browser.'}</Body>
      {!!error && <ErrorText>{error}</ErrorText>}
      {results && (results.listings.length ? <View style={layout.results}>
        <Heading>Matching listings</Heading>
        <Body>Matched “{results.query}”. Check the model, variant, and availability on the retailer’s site.</Body>
        {results.listings.map((listing) => <Pressable key={listing.url} accessibilityRole="link"
          accessibilityLabel={`Open ${listing.title} at ${listing.store}`} onPress={() => void open(listing.url)}
          style={({ pressed }) => [layout.listing, pressed && styles.faded]}>
          <View style={layout.listingText}><Text numberOfLines={3} style={layout.label}>{listing.title}</Text><Body>{listing.store}</Body></View>
          <Icon name="external" size={18} tint={color.muted} />
        </Pressable>)}
      </View> : <View style={layout.results}>
        <Heading>No matching listings</Heading><Body>Check the model number or try Google Shopping.</Body>
      </View>)}
      {endpoint !== null && <ActionLink label="Search Google Shopping" disabled={!query || loading} run={() => void open(googleShoppingUrl(query))} />}
    </View>
  </ActionSheet>;
}

const layout = StyleSheet.create({
  vision: { gap: 4 },
  readerActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  label: { color: color.ink, fontSize: 15, fontWeight: '600' },
  input: { color: color.ink, backgroundColor: color.paper, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, fontSize: 16 },
  results: { gap: 8 },
  listing: { minHeight: 56, gap: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  listingText: { flex: 1, gap: 4 },
});
