import { useEffect, useRef, useState } from 'react';
import { confirmArchive } from './ArchiveScreen';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ImageViewer } from './ImageViewer';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import { native, type Decision, type Feed, type Result } from './gallery';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, percent, styles, titleCase, useReducedMotion } from './ui';

export function Discover({ revision, open, initialMode = 'suggestions', initialCategory = null }: {
  revision: number; open: (item: Result) => void; initialMode?: Feed; initialCategory?: string | null;
}) {
  const [mode, setMode] = useState<Feed>(initialMode);
  const [group, setGroup] = useState<string | null>(initialCategory);
  const [groups, setGroups] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);
  const request = useRef(0);
  const reduced = useReducedMotion();

  function load(offset: number) {
    if (!native || loadingRef.current) return;
    const current = request.current;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    native.feed(mode, group, offset, 24).then((items) => {
      if (current !== request.current) return;
      setResults((previous) => offset === 0 ? items : previous.concat(items));
      setMore(items.length === 24);
    }).catch(() => {
      if (current === request.current) setError('Photo suggestions could not be loaded.');
    }).finally(() => {
      if (current === request.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    });
  }

  useEffect(() => {
    request.current++;
    loadingRef.current = false;
    setResults([]);
    setMore(false);
    load(0);
    return () => { request.current++; };
  }, [mode, group, revision]);

  useEffect(() => {
    let live = true;
    setGroups([]);
    if (mode === 'kept' || mode === 'suggestions') {
      native?.groups(mode === 'kept').then((names) => {
        if (live) setGroups(names);
      }).catch(() => {
        if (live) setGroups([]);
      });
    }
    return () => { live = false; };
  }, [mode, revision]);

  function switchMode(next: Feed) {
    setMode(next);
    setGroup(null);
  }

  const titles = { recent: 'Recently analyzed', quality: 'Low-quality candidates', screenshots: 'Screenshots',
    suggestions: 'Worth Revisiting', kept: 'Your collections', dismissed: 'Dismissed photos' };
  const empty = mode === 'suggestions' ? 'When Eye finds photos worth a second look, they’ll appear here.'
    : mode === 'kept' ? 'Keep or organize a photo to find it here again.'
      : mode === 'dismissed' ? 'Photos you dismiss will appear here.' : 'Eye has no matching photos here yet.';
  return <PhotoGrid<Result> data={results} keyExtractor={(item) => item.id}
    onEndReached={() => { if (more) load(results.length); }} onEndReachedThreshold={0.5}
    ListHeaderComponent={<View style={layout.galleryHeader}>
      <Heading large>{mode === 'recent' && group ? group : titles[mode]}</Heading>
      {mode === 'suggestions' && <Body>Ideas, screenshots, and moments worth a second look.</Body>}
      {mode === 'quality' && <Body>Eye flagged these photos with high confidence.</Body>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={layout.filters}>
        <Chip label="Revisit" selected={mode === 'suggestions'} run={() => switchMode('suggestions')} />
        <Chip label="Recent" selected={mode === 'recent'} run={() => switchMode('recent')} />
        <Chip label="Kept" selected={mode === 'kept'} run={() => switchMode('kept')} />
        <Chip label="Dismissed" selected={mode === 'dismissed'} run={() => switchMode('dismissed')} />
      </ScrollView>
      {groups.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={layout.filters}>
        <Chip label="All categories" selected={!group} run={() => setGroup(null)} />
        {groups.map((name) => <Chip key={name} label={name} selected={group === name} run={() => setGroup(name)} />)}
      </ScrollView>}
      {mode === 'recent' && group && <Chip label="Show all recent photos" run={() => setGroup(null)} />}
      {!!error && <ErrorText>{error}</ErrorText>}
    </View>}
    ListEmptyComponent={!loading && !error ? <EmptyState icon="bookmark" title="Nothing here yet" text={empty} /> : undefined}
    ListFooterComponent={loading ? <ActivityIndicator color={color.blue} /> :
      error ? <Button label="Retry" subtle run={() => load(results.length)} /> : undefined}
    renderTile={(item) => <PhotoTile uri={item.uri} label={item.category ? `${item.category}, ${item.name}` : item.name}
      fade={reduced ? 0 : 120} press={() => open(item)} />} />;
}

export function PhotoDetail({ item, close, changed, open }: {
  item: Result; close: () => void; changed: () => void; open: (photo: Result) => void;
}) {
  const [photo, setPhoto] = useState(item);
  const [similar, setSimilar] = useState<Result[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [collections, setCollections] = useState<string[]>([]);
  const [name, setName] = useState(item.collection ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision: Decision, collection: string | null = null) {
    if (!native || busy) return;
    setBusy(true);
    setError('');
    try {
      await native.decide(photo.id, decision, collection);
      setPhoto({ ...photo, decision, collection });
      setOrganizing(false);
      changed();
      if (decision === 'dismissed') close();
    } catch {
      setError('Nimby could not save this decision. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function findSimilar() {
    if (!native || loadingSimilar) return;
    setLoadingSimilar(true);
    setError('');
    try {
      setSimilar(await native.similar(photo.id));
    } catch {
      setError('Similar photos could not be loaded.');
    } finally {
      setLoadingSimilar(false);
    }
  }

  function organize() {
    setOrganizing(true);
    native?.groups(true).then(setCollections).catch(() => setCollections([]));
  }

  return <ImageViewer uri={photo.uri} label={photo.name} album={photo.album} close={close}
    summary={photo.category ?? 'Photo details'}>
    <Heading>{photo.name}</Heading>
        {photo.uri && <Button label="Open original" subtle run={() => {
          setError('');
          native?.openOriginal(photo.id).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'This photo could not be opened.');
          });
        }} />}
        <View style={styles.column}>
          <Heading>Eye classification</Heading>
          <Body>{photo.kind ? titleCase(photo.kind) : 'No image type returned'}{photo.confidence !== null ? ` · ${percent(photo.confidence)} confidence` : ''}</Body>
          {photo.tags.length > 0 && <View style={styles.row}>
            {photo.tags.map((tag) => <Text key={tag.label} style={layout.tag}>
              {titleCase(tag.label)} {percent(tag.confidence)}
            </Text>)}
          </View>}
        </View>
        <View style={styles.row}>
          {photo.decision === 'new' ? <Button label="Keep" disabled={busy} run={() => void decide('kept')} /> :
            <Button label="Undo decision" disabled={busy} subtle run={() => void decide('new')} />}
          {photo.decision !== 'dismissed' && <Button label="Dismiss" disabled={busy} subtle run={() => void decide('dismissed')} />}
          <Button label="Organize" disabled={busy} subtle run={organize} />
          {photo.uri && <Button label="Archive" disabled={busy} subtle run={() => {
            if (photo.uri) confirmArchive([photo.uri], () => { changed(); close(); });
          }} />}
        </View>
        {photo.decision === 'kept' && <Body>{photo.collection ? `Kept in ${photo.collection}` : 'Kept'}</Body>}
        {organizing && <View style={styles.column}>
          <Heading>Choose a collection</Heading>
          {collections.length > 0 && <View style={styles.row}>
            {collections.map((collection) => <Chip key={collection} label={collection} selected={name === collection} run={() => setName(collection)} />)}
          </View>}
          <TextInput accessibilityLabel="Collection name" placeholder="Collection name" placeholderTextColor={color.muted}
            value={name} onChangeText={setName} maxLength={60} style={layout.input} />
          <View style={styles.row}>
            <Button label="Save to collection" run={() => void decide('kept', name.trim())} disabled={busy || !name.trim()} />
            <Button label="Cancel" subtle run={() => setOrganizing(false)} />
          </View>
        </View>}
        {!!error && <ErrorText>{error}</ErrorText>}
        {similar === null ? <Button label={loadingSimilar ? 'Finding similar photos…' : 'Find similar photos'}
          subtle disabled={loadingSimilar} run={() => void findSimilar()} /> : <View style={styles.column}>
          <Heading>Similar photos</Heading>
          {similar.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={layout.filters}>
            {similar.map((result) => <View style={layout.similarTile} key={result.id}>
              <PhotoTile uri={result.uri} label={result.name} press={() => open(result)} />
              {result.similarity !== undefined && <Body>{percent(result.similarity)} similar</Body>}
            </View>)}
          </ScrollView> : <Body>No visually similar photos found among your analyzed images.</Body>}
        </View>}
  </ImageViewer>;
}

const layout = StyleSheet.create({
  galleryHeader: { gap: 10, paddingBottom: 8 },
  filters: { gap: 8 },
  similarTile: { width: 108, gap: 4 },
  tag: { backgroundColor: color.tint, color: color.deep, borderRadius: 10, padding: 8 },
  input: { color: color.ink, borderWidth: 1, borderColor: color.rule, borderRadius: 13,
    backgroundColor: color.paper, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
});
