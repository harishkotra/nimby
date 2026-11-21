import { ActionSheet } from './ActionSheet';
import { VoiceSearch } from './VoiceSearch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Result } from './gallery';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import {
  emptyRecallRequest, hasRecallRequest, parseRecallQuery, recallCategories, recallDateLabels, recallDateRange,
  type RecallPage, type RecallRequest, type RecallSearch, type RecallStatus,
} from './recallQuery';
import { ActionLink, Body, Button, IconButton, Chip, color, EmptyState, ErrorText, Heading, styles } from './ui';

type Props = {
  revision: number;
  open: (photo: Result) => void;
  active: boolean;
  indexed: number | null;
  scan: () => void;
  search: RecallSearch;
  status?: () => Promise<RecallStatus>;
  startBackfill?: () => void | Promise<unknown>;
};

type Hit = RecallPage['items'][number];
export function RecallScreen({ revision, open, active, indexed, scan, search, status, startBackfill }: Props) {
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState<RecallRequest>(emptyRecallRequest);
  const [draft, setDraft] = useState<RecallRequest | null>(null);
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
  const emptyIndex = indexed === 0;

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
    const text = query.trim();
    if (text) setTypedSearchDone(true);
    if (text === lastSubmitted.current) {
      if (hasRequest) setRequest({ ...request });
      return;
    }
    const previous = parseRecallQuery(lastSubmitted.current);
    const parsed = parseRecallQuery(text);
    lastSubmitted.current = text;
    setRequest({
      ...parsed,
      category: parsed.category ?? (request.category !== previous.category ? request.category : null),
      date: parsed.date ?? (request.date?.label !== previous.date?.label ? request.date : null),
      place: parsed.place ?? (request.place !== previous.place ? request.place : null),
      textOnly: parsed.textOnly || (request.textOnly && !previous.textOnly),
    });
  }

  function clearFilters() {
    setRequest({ ...emptyRecallRequest, terms: request.terms });
  }

  const header = <View style={layout.header}>
    <Heading large>Find a photo</Heading>
    <Body>Search analyzed photos. Archived and dismissed photos are hidden.</Body>
    {emptyIndex ? <EmptyState icon="scan" mascot="scanning" title="Make your photos searchable"
      text="Scan your gallery to find photos by what’s in them. Analysis happens on your phone."
      action={<Button label="Scan gallery" icon="scan" run={scan} />} /> : <>
      <VoiceSearch onTranscript={setQuery} active={active} deferPrompt={!typedSearchDone}>
        <IconButton icon="search" label="Search photos" run={submit} style={layout.searchIcon} />
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
          style={layout.searchInput}
        />
      </VoiceSearch>
      <ActionLink label="Filters" run={() => { Keyboard.dismiss(); setDraft({ ...request }); }} />
      {!hasRequest && <View style={layout.suggestions}>
        <Text style={layout.filterHeading}>Try searching for</Text>
        <View style={styles.row}>
          {(['receipts', 'screenshots with text', 'whiteboard', 'last month'] as const).map((hint) => (
            <Chip key={hint} label={hint} run={() => {
              setQuery(hint);
              lastSubmitted.current = hint;
              setTypedSearchDone(true);
              setRequest(parseRecallQuery(hint));
            }} />
          ))}
        </View>
      </View>}
      {hasFilters && <View style={styles.row}>
        {request.category && <Chip label={request.category} selected remove run={() => setRequest({ ...request, category: null })} />}
        {request.date && <Chip label={request.date.label} selected remove run={() => setRequest({ ...request, date: null })} />}
        {request.place && <Chip label={request.place} selected remove run={() => setRequest({ ...request, place: null })} />}
        {request.textOnly && <Chip label="With text" selected remove run={() => setRequest({ ...request, textOnly: false })} />}
        <ActionLink label="Clear filters" run={clearFilters} />
      </View>}
      {draft && <ActionSheet title="Search filters" close={() => setDraft(null)}
        footer={<Button label="Apply filters" run={() => {
          setRequest({ ...draft, place: draft.place?.trim() || null });
          setDraft(null);
        }} />}>
        <View style={layout.filters}>
          <Text style={layout.filterHeading}>Category</Text>
          <View style={styles.row}>
            <Chip label="Any category" selected={!draft.category} run={() => setDraft({ ...draft, category: null })} />
            {recallCategories.map((item) => <Chip key={item} label={item} selected={draft.category === item}
              run={() => setDraft({ ...draft, category: item })} />)}
          </View>
          <Text style={layout.filterHeading}>Date taken</Text>
          <View style={styles.row}>
            <Chip label="Any date" selected={!draft.date} run={() => setDraft({ ...draft, date: null })} />
            {recallDateLabels.map((label) => <Chip key={label} label={label} selected={draft.date?.label === label}
              run={() => setDraft({ ...draft, date: recallDateRange(label) })} />)}
          </View>
          <TextInput value={draft.place ?? ''} onChangeText={(place) => setDraft({ ...draft, place })}
            placeholder="Saved place name" placeholderTextColor={color.muted} accessibilityLabel="Saved place name"
            maxLength={64} returnKeyType="done" style={layout.input} />
          <View style={styles.row}><Chip label="Only photos with text" selected={draft.textOnly}
            run={() => setDraft({ ...draft, textOnly: !draft.textOnly })} /></View>
        </View>
      </ActionSheet>}
      {index && (index.running || index.pending > 0) && <Text style={styles.body} accessibilityLiveRegion="polite">
        {index.running ? 'Updating your photo index. Available matches appear below.' : 'Some photos are still waiting to be indexed.'}
      </Text>}
      {loadError && <ErrorText>Search is temporarily unavailable.</ErrorText>}
    </>}
  </View>;

  return <PhotoGrid<Hit>
    desired={2}
    data={emptyIndex ? [] : items}
    keyExtractor={(item) => item.photo.id}
    ListHeaderComponent={header}
    keyboardShouldPersistTaps="handled"
    onEndReachedThreshold={0.4}
    onEndReached={() => { if (active && !emptyIndex && next !== null && !loadError) void loadPage(next); }}
    ListEmptyComponent={!emptyIndex && hasRequest && !loading && !loadError
      ? <EmptyState icon="image" mascot="thinking" title="No matches"
        text={hasFilters
          ? `No photos matched${request.category ? ` in ${request.category}` : ''}${request.terms ? ` for “${request.terms}”` : ''}. Clear a filter or try a broader word.`
          : 'Try a different word you remember from the photo.'}
        action={hasFilters ? <ActionLink label={request.category ? `Clear ${request.category} filter` : 'Clear filters'}
          run={request.category ? () => setRequest({ ...request, category: null }) : clearFilters} /> : undefined} />
      : undefined}
    ListFooterComponent={emptyIndex ? undefined : loading
      ? <ActivityIndicator accessibilityLabel="Searching photos" color={color.blue} />
      : loadError ? <Button label="Try again" subtle run={() => void loadPage(next ?? 0)} /> : undefined}
    renderTile={({ photo, captured, evidence, place: savedPlace }) => {
      const details = [
        captured ? new Date(captured).toLocaleDateString() : null,
        savedPlace,
      ].filter(Boolean).join(' · ');
      const reasons = (evidence.length ? evidence : [
        photo.category ? `Eye category: ${photo.category}` : null,
        details || photo.name,
      ].filter(Boolean) as string[]).slice(0, 2);
      const reason = reasons.join(' · ');
      return <View style={layout.result}>
        <PhotoTile uri={photo.uri} label={`${photo.name}. ${reason}${details ? `. ${details}` : ''}`} ratio={1.1}
          press={() => open(photo)} />
        <Text style={layout.evidence} numberOfLines={3}>{reason}</Text>
        {!!details && !reasons.includes(details) && <Text style={styles.body} numberOfLines={1}>{details}</Text>}
      </View>;
    }}
  />;
}

const layout = StyleSheet.create({
  header: { gap: 12, paddingBottom: 8 },
  input: { backgroundColor: color.white, borderColor: color.rule, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12, color: color.ink, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: color.ink, fontSize: 17, minHeight: 56 },
  searchIcon: { backgroundColor: 'transparent' },
  filters: { gap: 12, padding: 12, borderColor: color.rule, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  filterHeading: { color: color.ink, fontSize: 15, fontWeight: '600' },
  suggestions: { gap: 8 },
  result: { gap: 4, paddingBottom: 12 },
  evidence: { color: color.ink, fontSize: 14, lineHeight: 19 },
});
