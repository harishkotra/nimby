import { useEffect, useRef, useState } from 'react';
import { useArchiveConfirmation } from './ArchiveScreen';
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

export function Revisit({ revision, open, openCategory, openMode, scan, browsing, toggleBrowse, search }: {
  revision: number; open: (item: Result) => void; openCategory: (category: string) => void;
  openMode: (mode: Feed) => void; scan: () => void; browsing: boolean; toggleBrowse: () => void; search: () => void;
}) {
  const [picks, setPicks] = useState<Result[] | null>(null);
  const [categories, setCategories] = useState<ReviewCategory[]>([]);
  const [error, setError] = useState(false);
  const [categoryError, setCategoryError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);

  function refreshPicks(nextSeen = seen) {
    setPicks(null);
    setSeen(nextSeen);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    let live = true;
    setError(false);
    native?.revisitPicks(seen).then((next) => {
      if (live) setPicks((previous) => previous == null ? next : previous.filter((photo) => next.some((item) => item.id === photo.id)));
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [revision, refresh, seen]);

  useEffect(() => {
    if (!browsing) return;
    let live = true;
    setCategoryError(false);
    native?.reviewCategories(null).then((next) => { if (live) setCategories(next); })
      .catch(() => { if (live) setCategoryError(true); });
    return () => { live = false; };
  }, [revision, browsing]);

  const lead = picks?.[0];
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={layout.intro}>
      <View style={styles.between}><Heading large>Worth revisiting</Heading>
        <Button label="Search" icon="search" subtle run={search} />
      </View>
      <Body>A few saved photos to come back to</Body>
    </View>
    {error ? <View style={layout.intro}><ErrorText>Could not load picks.</ErrorText>
      <Button label="Try again" subtle run={() => refreshPicks()} /></View> :
      picks == null ? <ActivityIndicator color={color.blue} /> :
      lead ? <View style={layout.pickStack}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Review ${lead.category || lead.name}`}
          onPress={() => open(lead)} style={({ pressed }) => [layout.pickLead, pressed && styles.faded]}>
          <Thumbnail uri={lead.uri} contain style={layout.pickImage} />
          <View style={layout.pickCaption}>
            <Text style={layout.sheetName}>{lead.category ?? 'Saved reference'}</Text>
            <Icon name="chevron" size={18} tint={color.muted} />
          </View>
        </Pressable>
        {picks.slice(1).map((photo) => <Pressable key={photo.id} accessibilityRole="button"
          accessibilityLabel={`Review ${photo.category || photo.name}`} onPress={() => open(photo)}
          style={({ pressed }) => [layout.pickRow, pressed && styles.faded]}>
          <Thumbnail uri={photo.uri} style={layout.pickThumb} />
          <Text style={layout.sheetName}>{photo.category ?? 'Saved reference'}</Text>
          <Icon name="chevron" size={18} tint={color.muted} />
        </Pressable>)}
        <Pressable accessibilityRole="button" style={styles.textAction}
          onPress={() => refreshPicks([...seen, ...picks.map((item) => item.id)].slice(-96))}>
          <Text style={styles.link}>Show different picks</Text>
          <Icon name="chevron" size={18} tint={color.muted} />
        </Pressable>
      </View> : <View style={layout.intro}>
        <Heading>No picks in this set</Heading>
        <View style={styles.row}>
          <Button label={seen.length ? 'Start over' : 'Check for picks'} subtle run={() => refreshPicks([])} />
          <Button label="Scan photos" subtle run={scan} />
        </View>
      </View>}
    <View style={layout.library}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: browsing }}
        onPress={toggleBrowse} style={({ pressed }) => [layout.libraryRow, pressed && styles.faded]}>
        <Text style={layout.sheetName}>Browse all categories</Text>
        <Icon name={browsing ? 'up' : 'down'} size={18} tint={color.muted} />
      </Pressable>
      {browsing && (categoryError ? <ErrorText>Could not load categories.</ErrorText> : categories.map((item) =>
        <Pressable key={item.name} accessibilityRole="button" onPress={() => openCategory(item.name)}
          accessibilityLabel={`${item.name}, ${item.count} photos`}
          style={({ pressed }) => [layout.libraryRow, pressed && styles.faded]}>
          <Text style={layout.sheetName}>{item.name}</Text>
          <Text style={layout.sheetCount}>{item.count.toLocaleString()}</Text>
          <Icon name="chevron" size={18} tint={color.muted} />
        </Pressable>))}
      <View style={layout.libraryRow}>
        <Pressable accessibilityRole="button" style={styles.textAction} onPress={() => openMode('kept')}>
          <Text style={styles.link}>Kept</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.textAction} onPress={() => openMode('dismissed')}>
          <Text style={styles.link}>Dismissed</Text>
        </Pressable>
      </View>
    </View>
  </ScrollView>;
}

function ScanCategories({ revision, scanId, openCategory }: {
  revision: number; scanId: string; openCategory: (name: string) => void;
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
      <Heading large>Scan results</Heading>
      {count ? <Body>{count.toLocaleString()} {count === 1 ? 'photo' : 'photos'} in {categories!.length} {categories!.length === 1 ? 'category' : 'categories'}</Body> : null}
    </View>
    {error ? <View style={layout.intro}>
      <ErrorText>Could not load categories.</ErrorText>
      <Button label="Try again" subtle run={() => setRetry((value) => value + 1)} />
    </View> : categories == null ? <ActivityIndicator color={color.blue} /> :
      categories.length === 0 ? <EmptyState icon="gallery"
        title="No results to show" text="This scan has no available analyzed photos to review."  /> :
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
  </ScrollView>;
}

export function Discover({ revision, open, mode, category, scanId, changed, openCategory }: {
  revision: number; open: (item: Result) => void; mode: ReviewMode; category: string | null; scanId: string | null;
  changed: () => void; openCategory: (name: string | null) => void;
}) {
  if (category == null && mode === 'scan' && scanId) {
    return <ScanCategories revision={revision} scanId={scanId} openCategory={openCategory} />;
  }
  return <ReviewPhotos key={JSON.stringify([mode, scanId, category])} revision={revision} open={open}
    mode={mode} category={category} scanId={scanId} changed={changed} openCategory={openCategory} />;
}

function ReviewPhotos({ revision, open, mode, category, scanId, changed, openCategory }: {
  revision: number; open: (item: Result) => void; mode: ReviewMode; category: string | null; scanId: string | null;
  changed: () => void; openCategory: (name: string | null) => void;
}) {
  const confirmArchive = useArchiveConfirmation();
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
  const confirmArchive = useArchiveConfirmation();
  const [photo, setPhoto] = useState(item);
  const [similar, setSimilar] = useState<Result[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [collections, setCollections] = useState<string[]>([]);
  const [name, setName] = useState(item.collection ?? '');
  const [moreActions, setMoreActions] = useState(false);
  const [modelDetails, setModelDetails] = useState(false);
  const [placeName, setPlaceName] = useState<string | null>(null);
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

  async function openPlaceEditor() {
    if (!native || busy) return;
    setBusy(true);
    setError('');
    try { setPlaceName(await native.memoryPlace(photo.id) ?? ''); }
    catch { setError('Could not read the saved place name.'); }
    finally { setBusy(false); }
  }

  async function savePlace() {
    if (!native || busy || placeName == null) return;
    setBusy(true);
    setError('');
    try {
      await native.setMemoryPlace(photo.id, placeName.trim() || null);
      setPlaceName(null);
      changed();
    } catch { setError('Could not save the place name.'); }
    finally { setBusy(false); }
  }

  const photoType = photo.kind ? titleCase(photo.kind) : null;
  const reference = photo.category && photo.category !== 'Other' ? photo.category : null;
  const finding = reference === 'Screenshots' && photoType === 'Screenshot' ? photoType : reference ?? photoType;
  const kept = photo.decision === 'kept';

  const detailRow = (label: string, run: () => void, disabled = false) =>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={run}
      style={({ pressed }) => [layout.detailRow, (pressed || disabled) && styles.faded]}>
      <Text style={layout.sheetName}>{label}</Text>
      <Icon name="chevron" size={18} tint={color.muted} />
    </Pressable>;

  return <ImageViewer uri={photo.uri} label={photo.name}
    album={finding ?? photo.album}
    subtitle={finding && photo.album ? photo.album : undefined}
    close={close}
    summary={finding ? `Eye · ${finding}` : 'Photo notes'}
    footer={(openDetails) => <View style={styles.row}>
      {kept ? <View accessible accessibilityLabel="Kept" style={layout.kept}>
        <Icon name="check" size={18} tint={color.blue} /><Body>Kept</Body>
      </View> : <Button label={photo.decision === 'dismissed' ? 'Undo dismissal' : 'Keep'} icon="bookmark"
        disabled={busy} style={layout.fill} run={() => void decide(photo.decision === 'new' ? 'kept' : 'new')} />}
      <Button label="Why / actions" subtle run={() => { setMoreActions(true); openDetails(); }} />
    </View>}>
    <View style={layout.notes}>
      <Text style={layout.noteLabel}>Identified by Eye</Text>
      <Heading>{finding ?? 'No clear match'}</Heading>
      {photoType && finding !== photoType && <Body>{photoType}</Body>}
      {photo.decision === 'kept' && photo.collection && <Body>In {photo.collection}</Body>}
    </View>
    {!!error && <ErrorText>{error}</ErrorText>}
    {moreActions && <View style={layout.details}>
      <Heading>Photo actions</Heading>
      {detailRow('Organize into a collection', organize, busy)}
      {detailRow('Edit place name', () => void openPlaceEditor(), busy)}
      {kept && detailRow('Undo keep', () => void decide('new'), busy)}
      {photo.decision !== 'dismissed' && detailRow('Dismiss suggestion', () => void decide('dismissed'), busy)}
      {photo.uri && detailRow('Archive photo', () => {
        if (photo.uri) confirmArchive([photo.uri], () => { changed(); close(); });
      }, busy)}
      {photo.uri && detailRow('Open in Photos', () => {
        setError('');
        native?.openOriginal(photo.id, photo.sourceKey ?? null).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'This photo could not be opened.');
        });
      })}
      {similar == null && detailRow(loadingSimilar ? 'Finding similar photos…' : 'Find similar photos',
        () => void findSimilar(), loadingSimilar)}
    </View>}
    {placeName != null && <View style={styles.column}>
      <Heading>Place name</Heading>
      <Body>Use this name to find the photo in Recall. Clear the field to remove it.</Body>
      <TextInput accessibilityLabel="Place name" placeholder="Place name" placeholderTextColor={color.muted}
        value={placeName} onChangeText={setPlaceName} maxLength={80} style={layout.input} />
      <View style={styles.row}>
        <Button label="Save place" run={() => void savePlace()} disabled={busy} />
        <Button label="Cancel" subtle run={() => setPlaceName(null)} disabled={busy} />
      </View>
    </View>}
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
    {similar !== null && <View style={styles.column}>
      <Heading>Similar photos</Heading>
      {similar.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={layout.filters}>
        {similar.map((result) => <View style={layout.similarTile} key={result.id}>
          <PhotoTile uri={result.uri} label={result.name} press={() => open(result)} />
          {result.similarity !== undefined && <Body>{percent(result.similarity)} similar</Body>}
        </View>)}
      </ScrollView> : <Body>No visual matches among your analyzed photos</Body>}
    </View>}
    {(photo.confidence != null || photo.tags.length > 0) && <View style={layout.details}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: modelDetails }} style={styles.textAction}
        onPress={() => setModelDetails(!modelDetails)}>
        <Text style={styles.link}>Model details</Text>
        <Icon name={modelDetails ? 'up' : 'down'} size={18} tint={color.muted} />
      </Pressable>
      {modelDetails && <>
        {photoType && photo.confidence != null && <Body>{photoType} · {percent(photo.confidence)} type confidence</Body>}
        {photo.tags.map((tag) => <View key={tag.label} style={layout.scoreRow}>
          <Text style={styles.body}>{titleCase(tag.label)}</Text>
          <Text style={layout.sheetCount}>{percent(tag.confidence)}</Text>
        </View>)}
      </>}
    </View>}
  </ImageViewer>;
}

const layout = StyleSheet.create({
  fill: { flex: 1 },
  intro: { gap: 4 },
  pickStack: { gap: 8 },
  pickLead: { backgroundColor: color.white, borderRadius: 16, overflow: 'hidden' },
  pickImage: { aspectRatio: 1.4, backgroundColor: color.black },
  pickCaption: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 56, paddingHorizontal: 16 },
  pickRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 64, paddingHorizontal: 8,
    backgroundColor: color.white, borderRadius: 12 },
  pickThumb: { width: 48, height: 48, borderRadius: 8 },
  library: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  libraryRow: { flexDirection: 'row', gap: 16, alignItems: 'center', minHeight: 48 },
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
  notes: { gap: 4, paddingBottom: 12 },
  kept: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 8 },
  noteLabel: { color: color.muted, fontSize: 14 },
  details: { gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  detailRow: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center' },
  scoreRow: { minHeight: 28, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  input: { color: color.ink, borderWidth: 1, borderColor: color.rule, borderRadius: 13,
    backgroundColor: color.paper, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
});
