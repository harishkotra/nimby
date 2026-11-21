import { useEffect, useRef, useState } from 'react';
import { confirmArchive } from './ArchiveScreen';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ImageViewer } from './ImageViewer';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import { native, type Decision, type Feed, type Result, type ReviewCategory } from './gallery';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, Icon, percent, styles, Thumbnail, titleCase, useReducedMotion } from './ui';

type ReviewMode = Feed | 'scan';

const titles: Record<ReviewMode, string> = {
  recent: 'Recently analyzed', quality: 'Quality review', screenshots: 'Screenshots',
  suggestions: 'Worth revisiting', kept: 'Kept photos', dismissed: 'Dismissed photos', scan: 'Scan results',
};

function Categories({ revision, mode, scanId, openCategory, openMode }: {
  revision: number; mode: 'suggestions' | 'scan'; scanId: string | null;
  openCategory: (name: string) => void; openMode: (mode: Feed) => void;
}) {
  const [categories, setCategories] = useState<ReviewCategory[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setError(false);
    native?.reviewCategories(scanId).then((groups) => { if (live) setCategories(groups); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [scanId, revision, retry]);

  const count = categories?.reduce((total, item) => total + item.count, 0);
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={layout.intro}>
      <Heading large>{titles[mode]}</Heading>
      {count ? <Body>{count.toLocaleString()} {count === 1 ? 'photo' : 'photos'} in {categories!.length} {categories!.length === 1 ? 'category' : 'categories'}</Body> : null}
    </View>
    {error ? <View style={layout.intro}>
      <ErrorText>Could not load categories.</ErrorText>
      <Button label="Try again" subtle run={() => setRetry((value) => value + 1)} />
    </View> : categories == null ? <ActivityIndicator color={color.blue} /> :
      categories.length === 0 ? <EmptyState icon="gallery"
        title={mode === 'scan' ? 'No results to show' : 'Nothing to revisit yet'}
        text={mode === 'scan' ? 'This scan has no available analyzed photos to review.' : 'References such as receipts and screenshots appear here after a scan.'} /> :
      <View style={layout.sheets}>
        {categories.map(({ name, count: groupCount, previews }) => <Pressable key={name}
          accessibilityRole="button" accessibilityLabel={`${titleCase(name)}, ${groupCount} photos`}
          onPress={() => openCategory(name)} style={({ pressed }) => [layout.sheetCard, pressed && styles.faded]}>
          {!!previews.length && <View style={layout.contactSheet} importantForAccessibility="no-hide-descendants">
            {previews.map((uri, index) => <Thumbnail key={`${uri}-${index}`} uri={uri} style={layout.contactPhoto} />)}
          </View>}
          <View style={layout.sheetLabel}>
            <Text style={layout.sheetName}>{titleCase(name)}</Text>
            <Text style={layout.sheetCount}>{groupCount.toLocaleString()}</Text>
            <Icon name="chevron" size={16} tint={color.muted} />
          </View>
        </Pressable>)}
      </View>}
    {mode === 'suggestions' && <View style={styles.row}>
      <Button label="Kept photos" subtle run={() => openMode('kept')} />
      <Button label="Dismissed" subtle run={() => openMode('dismissed')} />
    </View>}
  </ScrollView>;
}

export function Discover({ revision, open, mode, category, scanId, changed, openCategory, openMode }: {
  revision: number; open: (item: Result) => void; mode: ReviewMode; category: string | null; scanId: string | null;
  changed: () => void; openCategory: (name: string | null) => void; openMode: (mode: Feed) => void;
}) {
  if (category == null && (mode === 'suggestions' || mode === 'scan')) {
    return <Categories revision={revision} mode={mode} scanId={scanId} openCategory={openCategory} openMode={openMode} />;
  }
  return <ReviewPhotos key={JSON.stringify([mode, scanId, category])} revision={revision} open={open}
    mode={mode} category={category} scanId={scanId} changed={changed} openCategory={openCategory} />;
}

function ReviewPhotos({ revision, open, mode, category, scanId, changed, openCategory }: {
  revision: number; open: (item: Result) => void; mode: ReviewMode; category: string | null; scanId: string | null;
  changed: () => void; openCategory: (name: string | null) => void;
}) {
  const [groups, setGroups] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const loadingRef = useRef(false);
  const request = useRef(0);
  const reduced = useReducedMotion();

  function load(offset: number) {
    if (!native || loadingRef.current) return;
    const current = request.current;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    const page = mode === 'scan'
      ? (scanId ? native.scanFeed(scanId, category, offset, 24) : Promise.resolve([]))
      : native.feed(mode, category, offset, 24);
    page.then((items) => {
      if (current !== request.current) return;
      setResults((previous) => offset === 0 ? items : previous.concat(items));
      setMore(items.length === 24);
    }).catch(() => {
      if (current === request.current) setError('Could not load photos.');
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
    setSelection(null);
    load(0);
    return () => { request.current++; };
  }, [revision]);

  useEffect(() => {
    if (mode !== 'kept') return;
    let live = true;
    native?.groups(true).then((names) => { if (live) setGroups(names); }).catch(() => {});
    return () => { live = false; };
  }, [mode, revision]);

  function toggle(uri: string) {
    setSelection((previous) => {
      const next = new Set(previous);
      if (next.has(uri)) next.delete(uri);
      else if (next.size < 200) next.add(uri);
      return next;
    });
  }

  return <View style={layout.fill}>
    <PhotoGrid<Result> data={results} keyExtractor={(item) => item.sourceKey ?? item.id} extraData={selection}
      onEndReached={() => { if (more) load(results.length); }} onEndReachedThreshold={0.5}
      ListHeaderComponent={<View style={layout.galleryHeader}>
        <Heading large>{category ? titleCase(category) : titles[mode]}</Heading>
        {selection && <View style={styles.between}>
          <Body>{selection.size.toLocaleString()} selected</Body>
          <Pressable accessibilityRole="button" style={styles.textAction} onPress={() => {
            const loaded = results.flatMap((item) => item.uri ? [item.uri] : []);
            setSelection(new Set([...selection, ...loaded].slice(0, 200)));
          }}>
            <Text style={styles.link}>Select loaded photos</Text>
          </Pressable>
        </View>}
        {mode === 'kept' && groups.length > 0 && <View style={styles.row}>
          <Chip label="All kept" selected={!category} run={() => openCategory(null)} />
          {groups.map((name) => <Chip key={name} label={name} selected={category === name} run={() => openCategory(name)} />)}
        </View>}
        {!!error && <ErrorText>{error}</ErrorText>}
      </View>}
      ListEmptyComponent={!loading && !error ? <EmptyState icon="gallery" title="No photos here"
        text={mode === 'kept' ? 'Keep a photo to find it here later.' : 'Photos in this view may have been archived or become unavailable.'} /> : undefined}
      ListFooterComponent={loading ? <ActivityIndicator color={color.blue} /> :
        error ? <Button label="Try again" subtle run={() => load(results.length)} /> : undefined}
      renderTile={(item) => <PhotoTile uri={item.uri} label={item.name} fade={reduced ? 0 : 120}
        selected={selection && item.uri ? selection.has(item.uri) : undefined}
        longPress={item.uri ? () => toggle(item.uri!) : undefined}
        press={() => { if (!selection) open(item); else if (item.uri) toggle(item.uri); }} />} />
    {selection ? <View style={layout.selectionBar}>
      <Button label="Cancel" subtle run={() => setSelection(null)} />
      <Button label={selection.size ? `Archive ${selection.size.toLocaleString()}` : 'Archive photos'}
        style={layout.fill} icon="archive" disabled={!selection.size} run={() => confirmArchive([...selection], changed)} />
    </View> : results.some((photo) => photo.uri) && <View style={layout.selectionBar}>
      <Button label="Select photos" subtle run={() => setSelection(new Set())} />
    </View>}
  </View>;
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
          native?.openOriginal(photo.id, photo.sourceKey ?? null).catch((cause: unknown) => {
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
  fill: { flex: 1 },
  intro: { gap: 4 },
  galleryHeader: { gap: 12, paddingBottom: 8 },
  sheets: { gap: 12 },
  sheetCard: { borderRadius: 12, backgroundColor: color.white, overflow: 'hidden' },
  contactSheet: { flexDirection: 'row', gap: 4, padding: 4, paddingBottom: 0 },
  contactPhoto: { flexBasis: '32%', aspectRatio: 1.35, borderRadius: 8 },
  sheetLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8 },
  sheetName: { flex: 1, fontSize: 16, fontWeight: '600', color: color.ink },
  sheetCount: { color: color.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
  selectionBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 20,
    paddingVertical: 8, backgroundColor: color.paper, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  filters: { gap: 8 },
  similarTile: { width: 108, gap: 4 },
  tag: { backgroundColor: color.tint, color: color.deep, borderRadius: 10, padding: 8 },
  input: { color: color.ink, borderWidth: 1, borderColor: color.rule, borderRadius: 13,
    backgroundColor: color.paper, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
});
