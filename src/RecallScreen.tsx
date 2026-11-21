import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Result } from './gallery';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import {
  emptyRecallRequest, hasRecallRequest, parseRecallQuery, recallCategories, recallDateLabels, recallDateRange,
  type RecallPage, type RecallRequest, type RecallSearch, type RecallStatus,
} from './recallQuery';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, styles } from './ui';

type Props = {
  revision: number;
  open: (photo: Result) => void;
  search: RecallSearch;
  status?: () => Promise<RecallStatus>;
  startBackfill?: () => void | Promise<unknown>;
  voice?: (onTranscript: (text: string) => void, deferPrompt: boolean) => ReactNode;
};

type Hit = RecallPage['items'][number];
const collections = [
  { label: 'Receipts', category: 'Receipts', textOnly: false },
  { label: 'Documents', category: 'Documents', textOnly: false },
  { label: 'Screenshots with text', category: 'Screenshots', textOnly: true },
] as const;

export function RecallScreen({ revision, open, search, status, startBackfill, voice }: Props) {
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState<RecallRequest>(emptyRecallRequest);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [place, setPlace] = useState('');
  const [items, setItems] = useState<Hit[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [index, setIndex] = useState<RecallStatus | null>(null);
  const [typedSearchDone, setTypedSearchDone] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const lastSubmitted = useRef('');

  const hasRequest = hasRecallRequest(request);
  const indexFinished = index?.pending === 0 && !index.running;
  const hasFilters = Boolean(request.category || request.date || request.place || request.textOnly);

  useEffect(() => {
    if (!status) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await status();
        if (!active) return;
        setIndex(value);
        if (value.pending > 0 || value.running) timer = setTimeout(refresh, 1500);
      } catch {
        if (active) setIndex(null);
      }
    };

    void Promise.resolve().then(startBackfill).catch(() => {}).then(refresh);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [revision, startBackfill, status]);

  const loadPage = useCallback(async (offset: number) => {
    if (!hasRequest || inFlight.current) return;
    const current = generation.current;
    inFlight.current = true;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await search(request.terms, request.category, request.date?.start ?? null,
        request.date?.end ?? null, request.place, null, request.textOnly, offset);
      if (current !== generation.current) return;
      setItems((previous) => offset === 0 ? page.items : [...previous, ...page.items]);
      setNext(page.next);
    } catch {
      if (current === generation.current) setLoadError(true);
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [hasRequest, request, search]);

  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setItems([]);
    setNext(null);
    setLoading(false);
    setLoadError(false);
    void loadPage(0);
    return () => { generation.current++; };
  }, [loadPage, revision, indexFinished]);

  function submit() {
    Keyboard.dismiss();
    const changedText = query.trim() !== lastSubmitted.current;
    lastSubmitted.current = query.trim();
    if (query.trim()) setTypedSearchDone(true);
    if (!changedText) {
      if (hasRequest) setRequest({ ...request });
      return;
    }
    const parsed = parseRecallQuery(query);
    const selectedPlace = parsed.place ?? place.trim();
    setPlace(selectedPlace);
    setRequest({ ...parsed, place: selectedPlace || null });
  }

  function selectCollection(category: string, textOnly: boolean) {
    Keyboard.dismiss();
    setQuery('');
    setPlace('');
    lastSubmitted.current = '';
    setRequest({ ...emptyRecallRequest, category, textOnly });
  }

  function clearFilters() {
    setPlace('');
    setRequest({ ...emptyRecallRequest, terms: request.terms });
  }

  const header = <View style={layout.header}>
    <Heading large>Recall</Heading>
    <TextInput
      value={query}
      onChangeText={setQuery}
      onSubmitEditing={submit}
      placeholder="Find my electricity bill from last month"
      placeholderTextColor={color.muted}
      accessibilityLabel="Describe the photos you want to find"
      returnKeyType="search"
      autoCorrect={false}
      maxLength={256}
      style={layout.input}
    />
    <View style={styles.row}>
      <Button label="Search" run={submit} style={layout.grow} />
      <Button label={filtersOpen ? 'Hide filters' : 'Filters'} subtle icon="layers" run={() => setFiltersOpen(!filtersOpen)} />
    </View>
    {voice?.(setQuery, !typedSearchDone)}
    {!hasRequest && <View style={layout.suggestions}>
      <Text style={layout.filterHeading}>Try searching for</Text>
      <View style={styles.row}>
        {(['receipts', 'screenshots', 'whiteboard', 'last month'] as const).map((hint) => (
          <Chip key={hint} label={hint} run={() => {
            setQuery(hint);
            lastSubmitted.current = '';
            setTypedSearchDone(true);
            const parsed = parseRecallQuery(hint);
            setPlace(parsed.place ?? '');
            setRequest({ ...parsed, place: parsed.place });
          }} />
        ))}
      </View>
    </View>}
    {hasFilters && <View style={styles.row}>
      {request.category && <Chip label={request.category} selected run={() => setRequest({ ...request, category: null })} />}
      {request.date && <Chip label={request.date.label} selected run={() => setRequest({ ...request, date: null })} />}
      {request.place && <Chip label={request.place} selected run={() => {
        setPlace('');
        setRequest({ ...request, place: null });
      }} />}
      {request.textOnly && <Chip label="With text" selected run={() => setRequest({ ...request, textOnly: false })} />}
      <Pressable accessibilityRole="button" onPress={clearFilters} style={styles.textAction}>
        <Text style={styles.link}>Clear filters</Text>
      </Pressable>
    </View>}
    {filtersOpen && <View style={layout.filters}>
      <Text style={layout.filterHeading}>Category</Text>
      <View style={styles.row}>
        <Chip label="Any category" selected={!request.category} run={() => setRequest({ ...request, category: null })} />
        {recallCategories.map((item) => <Chip key={item} label={item} selected={request.category === item}
          run={() => setRequest({ ...request, category: item })} />)}
      </View>
      <Text style={layout.filterHeading}>Date taken</Text>
      <View style={styles.row}>
        <Chip label="Any date" selected={!request.date} run={() => setRequest({ ...request, date: null })} />
        {recallDateLabels.map((label) => <Chip key={label} label={label} selected={request.date?.label === label}
          run={() => setRequest({ ...request, date: recallDateRange(label) })} />)}
      </View>
      <Text style={layout.filterHeading}>Saved place name</Text>
      <View style={styles.row}>
        <TextInput value={place} onChangeText={setPlace}
          onSubmitEditing={() => setRequest({ ...request, place: place.trim() || null })}
          placeholder="Any place" placeholderTextColor={color.muted} accessibilityLabel="Saved place name"
          maxLength={64} returnKeyType="done" style={[layout.input, layout.grow]} />
        <Button label="Apply place" subtle run={() => {
          Keyboard.dismiss();
          setRequest({ ...request, place: place.trim() || null });
        }} />
      </View>
      <View style={styles.row}>
        <Chip label="Only photos with text" selected={request.textOnly}
          run={() => setRequest({ ...request, textOnly: !request.textOnly })} />
      </View>
    </View>}
    {!hasRequest && <View style={layout.collections}>
      <Text style={layout.filterHeading}>Browse collections</Text>
      <View style={styles.row}>
        {collections.map(({ label, category, textOnly }) => <Chip key={label} label={label}
          run={() => selectCollection(category, textOnly)} />)}
      </View>
    </View>}
    {index && (index.running || index.pending > 0) && <Text style={styles.body} accessibilityLiveRegion="polite">
      {index.running ? 'Updating your photo index. Available matches appear below.' : 'Some photos are still waiting to be indexed.'}
    </Text>}
    {loadError && <ErrorText>Search is temporarily unavailable.</ErrorText>}
  </View>;

  return <PhotoGrid<Hit>
    desired={2}
    data={items}
    keyExtractor={(item) => item.photo.id}
    ListHeaderComponent={header}
    keyboardShouldPersistTaps="handled"
    onEndReachedThreshold={0.4}
    onEndReached={() => { if (next !== null && !loadError) void loadPage(next); }}
    ListEmptyComponent={hasRequest && !loading && !loadError
      ? <EmptyState icon="image" mascot="thinking" title="No matches"
        text={hasFilters
          ? `No photos matched${request.category ? ` in ${request.category}` : ''}${request.terms ? ` for “${request.terms}”` : ''}. Clear a filter or try a broader word.`
          : 'Try a different word from the photo, or browse a collection below.'}
        action={<View style={styles.column}>
          {hasFilters && <Button label={request.category ? `Clear ${request.category} filter` : 'Clear filters'}
            subtle run={clearFilters} />}
          {!!request.terms && !!request.category && <Button label="Search without category"
            run={() => setRequest({ ...request, category: null, textOnly: false })} />}
        </View>} />
      : undefined}
    ListFooterComponent={loading
      ? <ActivityIndicator accessibilityLabel="Searching photos" color={color.blue} />
      : loadError ? <Button label="Try again" subtle run={() => void loadPage(next ?? 0)} /> : undefined}
    renderTile={({ photo, captured, evidence, place: savedPlace }) => {
      const details = [
        captured ? new Date(captured).toLocaleDateString() : null,
        savedPlace,
      ].filter(Boolean).join(' · ');
      const reason = evidence[0] ?? (photo.category ? `Eye category: ${photo.category}` : details || photo.name);
      return <View style={layout.result}>
        <PhotoTile uri={photo.uri} label={`${photo.name}. ${reason}${details ? `. ${details}` : ''}`} ratio={1.1}
          press={() => open(photo)} />
        <Text style={layout.evidence} numberOfLines={3}>{reason}</Text>
        {!!details && reason !== details && <Text style={styles.body} numberOfLines={1}>{details}</Text>}
      </View>;
    }}
  />;
}

const layout = StyleSheet.create({
  header: { gap: 12, paddingBottom: 8 },
  input: { backgroundColor: color.white, borderColor: color.rule, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12, color: color.ink, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
  grow: { flex: 1, minWidth: 100 },
  filters: { gap: 12, padding: 12, borderColor: color.rule, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  filterHeading: { color: color.ink, fontSize: 15, fontWeight: '600' },
  collections: { gap: 8, paddingTop: 8 },
  suggestions: { gap: 8 },
  result: { gap: 4, paddingBottom: 12 },
  evidence: { color: color.ink, fontSize: 14, lineHeight: 19 },
});
